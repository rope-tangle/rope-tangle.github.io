import { DEFAULT_SETTINGS, loadSettings, memoryStore, saveSettings, SETTINGS_KEY, type KeyValueStore } from "../src/game/settings";

const broken: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("settings", () => {
  it("starts from the defaults", () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips through the store under its own key", () => {
    const store = memoryStore();
    saveSettings(store, { ropes: 8, showMoves: false });
    expect(store.getItem(SETTINGS_KEY)).toBe("{\"ropes\":8,\"showMoves\":false}");
    expect(loadSettings(store)).toEqual({ ropes: 8, showMoves: false });
  });

  it("falls back per field on bad values", () => {
    const store = memoryStore();
    store.setItem(SETTINGS_KEY, "{\"ropes\":12,\"showMoves\":\"yes\"}");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.setItem(SETTINGS_KEY, "{\"ropes\":6}");
    expect(loadSettings(store)).toEqual({ ropes: 6, showMoves: true });
    store.setItem(SETTINGS_KEY, "not json");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it("survives a store that throws", () => {
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(broken, { ropes: 4, showMoves: true })).not.toThrow();
  });
});
