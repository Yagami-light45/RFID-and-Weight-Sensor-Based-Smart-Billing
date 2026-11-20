/*
  SMART BILLING TROLLEY — ESP32 DevKit V1, one .ino, no buzzer
  RC522: SDA/SS=5, RST=27, SCK=18, MISO=19, MOSI=23 (3.3 V)
  HX711: DT=32, SCK=33; LCD I2C: SDA=21, SCL=22 (0x27/0x3F)

  Physical flow: scan a registered RFID at the top, then place the item
  in the cart. The HX711 at the bottom measures *total* contents.
  After movement settles (or a timeout), POST one scan with cumulative grams.
  The server must be patched to retain items on MISMATCH; firmware alone
  cannot change that backend behavior.

  WARNING: Do not save real campus credentials in a public GitHub repo.
  Use a new/rotated PEAP password if an older sketch was shared.
*/

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <HX711.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <math.h>

// ==== Edit these settings locally; do not publish real credentials. ====
static const char* WIFI_SSID    = "IITI_Secure";
static const char* EAP_IDENTITY = "EAP_IDENTITY";
static const char* EAP_USERNAME = "EAP_USERNAME";
static const char* EAP_PASSWORD= "EAP_PASSWORD";
static const char* SERVER_IP  "[IP_ADDRESS]";  // Check current backend IP
static const uint16_t SERVER_PORT = 3000;
static const char* CART_ID = "CART_02";

// ==== Same scale settings as supplied in your HX711 sketch. ====
static constexpr int HX711_DT = 32;
static constexpr int HX711_SCK = 33;
static constexpr float CALIBRATION_FACTOR = 63.09f;
static constexpr float FILTER_ALPHA = 0.90f;
static constexpr float ZERO_THRESHOLD_GRAMS = 4.0f;
static constexpr uint32_t READ_INTERVAL_MS = 1000;
static constexpr uint32_t WARMUP_MS = 10000;
static constexpr uint8_t TARE_SAMPLES = 50;

// ==== Other working pins. ====
static constexpr uint8_t RFID_SS = 5;
static constexpr uint8_t RFID_RST = 27;  // Important: original working reset pin
static constexpr uint8_t LCD_SDA = 21;
static constexpr uint8_t LCD_SCL = 22;

// Scan -> placement -> stable weight -> one HTTP POST, max one retry.
static constexpr uint32_t RFID_SAME_UID_COOLDOWN_MS = 6000;
static constexpr uint32_t MIN_PLACEMENT_MS = 2500;
static constexpr uint32_t PLACEMENT_TIMEOUT_MS = 10000;
static constexpr float MOVEMENT_DETECTION_GRAMS = 8.0f;
static constexpr float STABILITY_SPREAD_GRAMS = 8.0f;
static constexpr uint32_t HTTP_TIMEOUT_MS = 25000;
static constexpr uint32_t HTTP_RETRY_MS = 6000;
static constexpr uint8_t MAX_POST_ATTEMPTS = 2; // 1 initial attempt + 1 retry
static constexpr uint32_t WIFI_RETRY_MS = 20000;

MFRC522 rfid(RFID_SS, RFID_RST);
HX711 scale;
LiquidCrystal_I2C lcd27(0x27, 16, 2);
LiquidCrystal_I2C lcd3f(0x3F, 16, 2);
LiquidCrystal_I2C* display = nullptr;

bool scaleReady = false;
bool filterStarted = false;
float filteredWeight = 0.0f;
float latestRawWeight = 0.0f;
float displayWeight = 0.0f;
uint32_t lastRead = 0;
uint32_t lastLCD = 0;
uint32_t lcdHoldUntil = 0;
uint32_t lastWifiAttempt = 0;
uint32_t eventCounter = 0;
uint32_t lastRfidAt = 0;
String lastRfidUID = "";
String lastUID = "";
String serialLine = "";
bool autoPost = true;

// Small window of filtered weights to detect when the trolley has settled.
static constexpr uint8_t STABILITY_WINDOW = 5;
float recentWeights[STABILITY_WINDOW] = {};
uint8_t recentCount = 0;
uint8_t recentIndex = 0;

struct PendingScan {
  bool active = false;
  String uid;
  String eventID;
  float baselineGrams = 0;
  bool movementSeen = false;
  uint32_t scannedAt = 0;
  uint32_t lastAttemptAt = 0;
  uint8_t attempts = 0;
};
PendingScan pending;

String baseURL() {
  return String("http://") + SERVER_IP + ":" + SERVER_PORT;
}

void showLCD(const String& row1, const String& row2, uint32_t holdMs = 0) {
  if (!display) return;
  display->clear();
  display->setCursor(0, 0);
  display->print(row1.substring(0, 16));
  display->setCursor(0, 1);
  display->print(row2.substring(0, 16));
  if (holdMs) lcdHoldUntil = millis() + holdMs;
}

void initLCD() {
  Wire.begin(LCD_SDA, LCD_SCL);
  const uint8_t addresses[2] = {0x27, 0x3F};
  for (uint8_t addr : addresses) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      display = addr == 0x27 ? &lcd27 : &lcd3f;
      display->init();
      display->backlight();
      showLCD("LCD connected", "Ready", 1000);
      Serial.printf("[LCD] Found at 0x%02X\n", addr);
      return;
    }
  }
  Serial.println("[LCD] Not found at 0x27 or 0x3F; Serial still works.");
}

void refreshLCD() {
  const uint32_t now = millis();
  if (static_cast<int32_t>(now - lcdHoldUntil) < 0) return;
  if (now - lastLCD < 850) return;
  lastLCD = now;
  const String weightText = scaleReady ? String(displayWeight, 1) + "g" : "N/A";
  showLCD("Total: " + weightText,
          pending.active ? "Place item..." : (WiFi.status() == WL_CONNECTED ? "Scan RFID" : "WiFi offline"));
}

void connectWiFi() {
  lastWifiAttempt = millis();
  if (String(EAP_IDENTITY).startsWith("YOUR_") ||
      String(EAP_USERNAME).startsWith("YOUR_") ||
      String(EAP_PASSWORD).startsWith("YOUR_")) {
    Serial.println("[WiFi] Fill PEAP identity/username/password in the sketch first.");
    showLCD("Set WiFi creds", "Edit .ino", 3000);
    return;
  }
  Serial.println("[WiFi] Connecting to IITI_Secure using PEAP...");
  WiFi.disconnect(true);
  delay(250);
  WiFi.mode(WIFI_STA);
  // Keep the same WPA2-Enterprise PEAP call as the firmware that worked.
  WiFi.begin(WIFI_SSID, WPA2_AUTH_PEAP, EAP_IDENTITY, EAP_USERNAME, EAP_PASSWORD);
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000UL) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WiFi] CONNECTED");
    Serial.print("[WiFi] ESP32 IP: "); Serial.println(WiFi.localIP());
    Serial.print("[WiFi] Gateway: "); Serial.println(WiFi.gatewayIP());
    Serial.printf("[WiFi] RSSI: %d dBm\n", WiFi.RSSI());
    Serial.println("[WiFi] Backend: " + baseURL());
    showLCD("WiFi connected", WiFi.localIP().toString(), 1600);
  } else {
    Serial.println("[WiFi] Connection failed; use WIFI in Serial Monitor.");
  }
}

void maybeReconnectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS) return;
  connectWiFi();
}

// Run only when the empty trolley platform has had time to settle.
void initScale() {
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  Serial.println("[HX711] Keep trolley EMPTY: warming up for 10 seconds...");
  showLCD("Keep cart empty", "Warmup 10 sec", 10000);
  delay(WARMUP_MS);
  if (!scale.wait_ready_timeout(2000)) {
    scaleReady = false;
    Serial.println("[HX711] Not ready. Verify DT=32, SCK=33, power, ground.");
    showLCD("HX711 not ready", "Check wiring", 3000);
    return;
  }
  Serial.println("[HX711] Taring with 50 samples. Keep trolley EMPTY...");
  showLCD("Taring...", "Cart EMPTY", 3000);
  scale.tare(TARE_SAMPLES);
  scaleReady = true;
  filterStarted = false;
  recentCount = 0;
  recentIndex = 0;
  filteredWeight = 0;
  latestRawWeight = 0;
  displayWeight = 0;
  Serial.printf("[HX711] Tare complete; scale factor %.2f counts/g\n", CALIBRATION_FACTOR);
  Serial.println("[HX711] Calibration factor is user-supplied,for this load cell.");
}

bool weightStable() {
  if (!scaleReady || !filterStarted || recentCount < STABILITY_WINDOW) return false;
  float lo = recentWeights[0], hi = recentWeights[0];
  for (uint8_t i = 1; i < STABILITY_WINDOW; ++i) {
    if (recentWeights[i] < lo) lo = recentWeights[i];
    if (recentWeights[i] > hi) hi = recentWeights[i];
  }
  return (hi - lo) <= STABILITY_SPREAD_GRAMS;
}

void sampleWeight() {
  if (!scaleReady) return;
  if (millis() - lastRead < READ_INTERVAL_MS || !scale.is_ready()) return;
  lastRead = millis();

  // Three HX711 conversions averaged, then exponential moving average.
  const float weight = scale.get_units(10);
  if (!isfinite(weight)) {
    Serial.println("[HX711] Invalid reading; ignoring sample");
    return;
  }
  latestRawWeight = weight;
  if (!filterStarted) {
    filteredWeight = weight;
    filterStarted = true;
  } else {
    filteredWeight = FILTER_ALPHA * weight +
                     (1.0f - FILTER_ALPHA) * filteredWeight;
  }
  displayWeight = fabsf(filteredWeight) < ZERO_THRESHOLD_GRAMS ? 0.0f : filteredWeight;

  recentWeights[recentIndex] = displayWeight;
  recentIndex = (recentIndex + 1) % STABILITY_WINDOW;
  if (recentCount < STABILITY_WINDOW) ++recentCount;

  if (pending.active && fabsf(displayWeight - pending.baselineGrams) >= MOVEMENT_DETECTION_GRAMS)
    pending.movementSeen = true;

  Serial.printf("[HX711] Raw %.2f g | Display %.2f g | Stable %s\n",
                latestRawWeight, displayWeight, weightStable() ? "YES" : "NO");
}

String jsonStatus(const String& json) {
  int start = json.indexOf("\"status\":\"");
  if (start < 0) return "UNKNOWN";
  start += 10;
  const int end = json.indexOf('"', start);
  return end > start ? json.substring(start, end) : "UNKNOWN";
}

bool postPendingScan() {
  if (!pending.active || WiFi.status() != WL_CONNECTED) return false;

  // Retry at most once (two attempts in total for each scan).
  if (pending.attempts >= MAX_POST_ATTEMPTS) {
    pending.active = false;
    return false;
  }
  if (pending.attempts > 0 && millis() - pending.lastAttemptAt < HTTP_RETRY_MS)
    return false;

  // Old /scan route requires nonnegative cumulative measuredWeight.
  float postGrams = scaleReady && filterStarted ? displayWeight : 0.0f;
  if (!isfinite(postGrams) || postGrams < 0.0f) {
    Serial.printf("[HX711] Invalid/negative total %.2f g; POST uses diagnostic 0g.\n", postGrams);
    postGrams = 0.0f;
  }
  if (!scaleReady) Serial.println("[HX711] Sensor unavailable; sending diagnostic 0g.");

  const String url = baseURL() + "/api/cart/" + CART_ID + "/scan";
  const String body = "{\"rfidUid\":\"" + pending.uid +
                      "\",\"measuredWeight\":" + String(postGrams, 2) +
                      ",\"eventId\":\"" + pending.eventID + "\"}";
  ++pending.attempts;
  Serial.printf("[POST] Attempt %u/%u\n", pending.attempts, MAX_POST_ATTEMPTS);
  Serial.println("[POST] " + url);
  Serial.println("[POST] " + body);

  // Reuse the event ID so the backend can deduplicate timeout retries.
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, url)) {
    pending.lastAttemptAt = millis();
    Serial.println("[POST] http.begin failed");
    if (pending.attempts >= MAX_POST_ATTEMPTS) {
      pending.active = false;
      Serial.println("[POST] Retry limit reached. Scan cleared.");
      showLCD("POST failed", "Scan again", 2000);
    } else {
      Serial.println("[POST] Retrying once in 6 seconds...");
      showLCD("POST failed", "Retry once", 1500);
    }
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  Serial.printf("[POST] HTTP code: %d\n", code);
  if (code > 0) {
    const String response = http.getString();
    const String status = jsonStatus(response);
    Serial.println("[POST] Body: " + response);
    Serial.println("[POST] Status: " + status);
    showLCD("RFID " + status, pending.uid, 2200);
  } else {
    Serial.println("[POST] Error: " + http.errorToString(code));
  }
  http.end();
  pending.lastAttemptAt = millis();

  if (code == 200 || code == 404 || (code >= 400 && code < 500 && code != 429)) {
    // The server responded conclusively. Do not retry.
    pending.active = false;
    Serial.println("[POST] Completed. Scan cleared.");
    return true;
  }

  // Retry eligible errors (timeouts, HTTP 5xx, 429) only once.
  if (pending.attempts >= MAX_POST_ATTEMPTS) {
    pending.active = false;
    Serial.println("[POST] Second attempt failed. No more retries.");
    showLCD("POST failed", "Scan again", 2000);
    return false;
  }

  Serial.println("[POST] Failed. Retrying once in 6 seconds using same eventId.");
  showLCD("POST failed", "Retry once", 1500);
  return false;
}

void pollPending() {
  if (!pending.active) return;
  const uint32_t elapsed = millis() - pending.scannedAt;
  if (elapsed < MIN_PLACEMENT_MS) return;
  const bool readyToPost =
      (pending.movementSeen && weightStable()) ||
      elapsed >= PLACEMENT_TIMEOUT_MS ||
      !scaleReady;
  if (!readyToPost) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (elapsed >= PLACEMENT_TIMEOUT_MS && pending.attempts == 0)
    Serial.println("[RFID] Placement timeout; POST latest weight and show mismatch if needed.");
  postPendingScan();
}

void pollRFID() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  String uid;
  for (byte i = 0; i < rfid.uid.size; ++i) {
    if (rfid.uid.uidByte[i] < 0x10) uid += '0';
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  lastUID = uid;
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  Serial.println("[RFID] Card UID: " + uid);

  if (!autoPost) {
    Serial.println("[RFID] Auto POST OFF; card read only.");
    showLCD("RFID read", uid, 2000);
    return;
  }
  if (pending.active) {
    Serial.println("[RFID] Previous scan is pending; wait for POST, then scan again.");
    showLCD("Wait for POST", pending.uid, 2000);
    return;
  }
  if (uid == lastRfidUID && millis() - lastRfidAt < RFID_SAME_UID_COOLDOWN_MS) {
    Serial.println("[RFID] Same UID cooldown: remove card and wait 6 seconds.");
    return;
  }

  lastRfidUID = uid;
  lastRfidAt = millis();
  pending = PendingScan();
  pending.active = true;
  pending.uid = uid;
  pending.eventID = String("HW-") + String((uint32_t)esp_random(), HEX) +
                    "-" + String(++eventCounter);
  pending.baselineGrams = scaleReady ? displayWeight : 0.0f;
  pending.scannedAt = millis();
  Serial.println("[RFID] Place the scanned item into trolley; awaiting cumulative weight.");
  Serial.println("[RFID] Cart ID: " + String(CART_ID));
  showLCD("RFID: " + uid, "Place item now", 2200);
}

void getTest() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[GET] WiFi offline; type WIFI first.");
    return;
  }
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  const String url = baseURL() + "/api/admin/overview";
  Serial.println("[GET] " + url);
  if (!http.begin(client, url)) return;
  const int code = http.GET();
  Serial.printf("[GET] HTTP code: %d\n", code);
  if (code < 0) Serial.println("[GET] Error: " + http.errorToString(code));
  http.end();
}

void printHelp() {
  Serial.println("\nCommands: STATUS | WEIGHT | TARE | WIFI | GET | AUTOON | AUTOOFF | HELP");
  Serial.println("Scan RFID at top, then put item into cart. No buzzer, no checkout.");
}

void handleCommand(String cmd) {
  cmd.trim(); cmd.toUpperCase();
  if (cmd == "HELP") printHelp();
  else if (cmd == "STATUS") {
    Serial.println("[Status] WiFi: " + String(WiFi.status() == WL_CONNECTED ? "CONNECTED" : "OFFLINE"));
    Serial.println("[Status] Scale: " + String(scaleReady ? "READY" : "NOT READY"));
    Serial.printf("[Status] Total filtered: %.2f g; stable: %s\n",
                  displayWeight, weightStable() ? "YES" : "NO");
    Serial.println("[Status] Cart: " + String(CART_ID));
    Serial.println("[Status] Last RFID: " + lastUID);
    Serial.println("[Status] Pending UID: " + String(pending.active ? pending.uid : "NONE"));
    Serial.println("[Status] Auto: " + String(autoPost ? "ON" : "OFF"));
  } else if (cmd == "WEIGHT") {
    Serial.printf("[WEIGHT] Raw %.2f g, filtered %.2f g, stable: %s\n",
                  latestRawWeight, displayWeight, weightStable() ? "YES" : "NO");
  } else if (cmd == "TARE") {
    if (pending.active) {
      Serial.println("[HX711] Wait for pending RFID POST before taring.");
    } else if (!scale.wait_ready_timeout(1500)) {
      Serial.println("[HX711] Not ready for tare");
    } else {
      Serial.println("[HX711] Taring 50 samples; trolley MUST be empty...");
      scale.tare(TARE_SAMPLES);
      scaleReady = true;
      filterStarted = false;
      recentCount = 0;
      recentIndex = 0;
      filteredWeight = displayWeight = latestRawWeight = 0;
      Serial.println("[HX711] Tare complete.");
    }
  } else if (cmd == "WIFI") connectWiFi();
  else if (cmd == "GET") getTest();
  else if (cmd == "AUTOON") { autoPost = true; Serial.println("[RFID] Auto POST ON"); }
  else if (cmd == "AUTOOFF") { autoPost = false; Serial.println("[RFID] Auto POST OFF"); }
  else Serial.println("[Serial] Unknown command; type HELP");
}

void pollSerial() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLine.length()) {
        handleCommand(serialLine);
        serialLine = "";
      }
    } else if (serialLine.length() < 64) {
      serialLine += c;
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println("\nSMART TROLLEY: RC522 + HX711 + LCD + IITI_Secure PEAP");
  Serial.println("Single sketch, no buzzer, automatic cumulative-weight RFID POST.");
  Serial.println("[Cart] " + String(CART_ID));
  initLCD();
  SPI.begin(18, 19, 23, RFID_SS);
  rfid.PCD_Init();
  delay(100);
  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("[RFID] VersionReg: 0x%02X\n", version);
  initScale();
  connectWiFi();
  printHelp();
}

void loop() {
  sampleWeight();
  pollRFID();
  pollPending();
  pollSerial();
  refreshLCD();
  maybeReconnectWiFi();
  delay(10);
}