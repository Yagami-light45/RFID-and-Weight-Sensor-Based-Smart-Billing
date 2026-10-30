type Listener = (event: string, data: unknown) => void;

const globalForBus = globalThis as unknown as {
  trolleyBus?: Map<string, Set<Listener>>;
};

function channels() {
  if (!globalForBus.trolleyBus) {
    globalForBus.trolleyBus = new Map();
  }
  return globalForBus.trolleyBus;
}

export function cartChannel(cartId: string) {
  return `cart_:${cartId}`;
}

export const ADMIN_CHANNEL = "admin";

export function subscribe(channel: string, listener: Listener) {
  const bus = channels();
  const listeners = bus.get(channel) ?? new Set<Listener>();
  listeners.add(listener);
  bus.set(channel, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      bus.delete(channel);
    }
  };
}

export function publish(channel: string, event: string, data: unknown) {
  const listeners = channels().get(channel);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(event, data);
  }
}
