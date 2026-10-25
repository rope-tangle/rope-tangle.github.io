import type { Events } from "../src/analytics/umami";
import { createUpdateController, FALLBACK_RELOAD_MS, reloadOnceActivated, watchInstalls, setupUpdateChecks, type UpdateController, type UpdateControllerDeps } from "../src/pwa/update-controller";

type Sent = [keyof Events, unknown][];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(over: Partial<UpdateControllerDeps> = {}) {
  const sent: Sent = [];
  const deps = {
    prepareReload: vi.fn(() => Promise.resolve()),
    showIndicator: vi.fn<(onRefresh: () => void) => void>(),
    fallbackReload: vi.fn(),
    scheduleFallback: vi.fn<(handler: () => void, ms: number) => void>(),
  };
  const updateSW = vi.fn(() => Promise.resolve());
  const track = (name: keyof Events, data: unknown) => void sent.push([name, data]);
  const controller = createUpdateController({ track, ...deps, ...over });
  const tap = () => {
    controller.onNeedRefresh();
    deps.showIndicator.mock.calls[0]![0]();
  };
  return { sent, deps, updateSW, controller, tap };
}

describe("update controller", () => {
  it("shows the button once", () => {
    const { controller, deps, sent } = setup();
    controller.onNeedRefresh();
    controller.onNeedRefresh();
    expect(deps.showIndicator).toHaveBeenCalledOnce();
    expect(sent.filter(([n]) => n === "pwa-update-detected")).toEqual([["pwa-update-detected", {}]]);
  });

  it("prepares the game before activating the new worker", async () => {
    let finish = () => {};
    const { controller, updateSW, tap } = setup({ prepareReload: () => new Promise<void>((resolve) => (finish = () => resolve())) });
    controller.setUpdateSW(updateSW);
    tap();
    await settle();
    expect(updateSW).not.toHaveBeenCalled();
    finish();
    await settle();
    expect(updateSW).toHaveBeenCalledOnce();
  });

  it("reports the update applied only once the game is ready to reload", async () => {
    let finish = () => {};
    const { controller, updateSW, sent, tap } = setup({ prepareReload: () => new Promise<void>((resolve) => (finish = () => resolve())) });
    controller.setUpdateSW(updateSW);
    tap();
    await settle();
    expect(sent.map(([n]) => n)).not.toContain("pwa-update-applied");
    finish();
    await settle();
    expect(sent).toContainEqual(["pwa-update-applied", { trigger: "manual" }]);
  });

  it("applies once, however often it is triggered while preparing", async () => {
    let finish = () => {};
    const prepareReload = vi.fn(() => new Promise<void>((resolve) => (finish = () => resolve())));
    const { controller, deps, updateSW, tap } = setup({ prepareReload });
    controller.setUpdateSW(updateSW);
    tap();
    deps.showIndicator.mock.calls[0]![0]();
    controller.requestReloadIfPending();
    finish();
    await settle();
    expect(prepareReload).toHaveBeenCalledOnce();
    expect(updateSW).toHaveBeenCalledOnce();
    expect(deps.scheduleFallback).toHaveBeenCalledOnce();
  });

  it("buffers a request made before updateSW exists and applies it once set", async () => {
    const { controller, deps, updateSW, sent } = setup();
    controller.onNeedRefresh();
    controller.requestReloadIfPending();
    await settle();
    expect(deps.prepareReload).not.toHaveBeenCalled();
    controller.setUpdateSW(updateSW);
    controller.setUpdateSW(updateSW);
    await settle();
    expect(updateSW).toHaveBeenCalledOnce();
    expect(sent).toContainEqual(["pwa-update-applied", { trigger: "focus-regain" }]);
  });

  it("does nothing on setUpdateSW when no update was requested", async () => {
    const { controller, updateSW } = setup();
    controller.setUpdateSW(updateSW);
    await settle();
    expect(updateSW).not.toHaveBeenCalled();
  });

  it("applies on return to the foreground only while an update is pending", async () => {
    const { controller, updateSW, sent } = setup();
    controller.setUpdateSW(updateSW);
    controller.requestReloadIfPending();
    await settle();
    expect(updateSW).not.toHaveBeenCalled();
    controller.onNeedRefresh();
    controller.requestReloadIfPending();
    await settle();
    expect(updateSW).toHaveBeenCalledOnce();
    expect(sent).toContainEqual(["pwa-update-applied", { trigger: "focus-regain" }]);
  });

  it("applies with the manual trigger when the button is tapped", async () => {
    const { controller, updateSW, sent, tap } = setup();
    controller.setUpdateSW(updateSW);
    tap();
    await settle();
    expect(updateSW).toHaveBeenCalledOnce();
    expect(sent).toContainEqual(["pwa-update-applied", { trigger: "manual" }]);
  });

  it("falls back to a hard reload after the fallback delay", async () => {
    const { controller, deps, updateSW, sent, tap } = setup();
    controller.setUpdateSW(updateSW);
    tap();
    await settle();
    expect(deps.scheduleFallback).toHaveBeenCalledWith(expect.any(Function), FALLBACK_RELOAD_MS);
    expect(deps.fallbackReload).not.toHaveBeenCalled();
    deps.scheduleFallback.mock.calls[0]![0]();
    expect(deps.fallbackReload).toHaveBeenCalledOnce();
    expect(sent).toContainEqual(["pwa-update-fallback-reload", {}]);
  });

  it("reports an activation that rejects and still schedules the fallback", async () => {
    const { controller, deps, sent, tap } = setup();
    controller.setUpdateSW(() => Promise.reject(new Error("boom")));
    tap();
    await settle();
    expect(sent).toContainEqual(["pwa-update-apply-failed", { reason: "boom" }]);
    expect(deps.scheduleFallback).toHaveBeenCalledOnce();
  });
});


function checks(update: () => Promise<unknown> | void, visible = true, checkNow = false) {
  const sent: Sent = [];
  const registration = { update: vi.fn(update) };
  const requestReloadIfPending = vi.fn();
  const controller: UpdateController = { onNeedRefresh: vi.fn(), setUpdateSW: vi.fn(), requestReloadIfPending };
  let onVisibility = () => {};
  setupUpdateChecks(registration, controller, {
    track: (name, data) => void sent.push([name, data]),
    addVisibilityListener: (handler) => (onVisibility = handler),
    isVisible: () => visible,
    checkNow,
  });
  return { sent, registration, requestReloadIfPending, show: () => onVisibility() };
}

describe("update checks", () => {
  it("checks once at setup when asked, without applying anything", () => {
    const { registration, requestReloadIfPending } = checks(() => undefined, true, true);
    expect(registration.update).toHaveBeenCalledOnce();
    expect(requestReloadIfPending).not.toHaveBeenCalled();
  });

  it("reports a failing check at setup", async () => {
    const { sent } = checks(() => Promise.reject(new Error("offline")), true, true);
    await settle();
    expect(sent).toEqual([["pwa-update-check-failed", { reason: "offline" }]]);
  });

  it("does not check at setup", () => {
    expect(checks(() => undefined).registration.update).not.toHaveBeenCalled();
  });

  it("checks and applies a pending update when the page becomes visible", () => {
    const { registration, requestReloadIfPending, show } = checks(() => undefined);
    show();
    expect(registration.update).toHaveBeenCalledOnce();
    expect(requestReloadIfPending).toHaveBeenCalledOnce();
  });

  it("ignores the page becoming hidden", () => {
    const { registration, requestReloadIfPending, show } = checks(() => undefined, false);
    show();
    expect(registration.update).not.toHaveBeenCalled();
    expect(requestReloadIfPending).not.toHaveBeenCalled();
  });

  it("reports nothing when a check succeeds", async () => {
    const { sent, show } = checks(() => Promise.resolve());
    show();
    await settle();
    expect(sent).toEqual([]);
  });

  it("reports each failing reason once", async () => {
    const { sent, show } = checks(() => Promise.reject(new Error("offline")));
    for (let i = 0; i < 4; i++) {
      show();
      await settle();
    }
    expect(sent).toEqual([["pwa-update-check-failed", { reason: "offline" }]]);
  });

  it("reports at most five distinct reasons", async () => {
    let i = 0;
    const { sent, show } = checks(() => Promise.reject(new Error(`reason-${i++}`)));
    for (let n = 0; n < 6; n++) {
      show();
      await settle();
    }
    expect(sent.map(([, d]) => d)).toEqual([0, 1, 2, 3, 4].map((n) => ({ reason: `reason-${n}` })));
  });
});

function fakeWorker() {
  const listeners: (() => void)[] = [];
  return {
    state: "installing",
    addEventListener: (_type: "statechange", handler: () => void) => void listeners.push(handler),
    become(state: string) {
      this.state = state;
      for (const l of listeners) l();
    },
  };
}

function installs(already: ReturnType<typeof fakeWorker> | null = null, { active = true, online = true } = {}) {
  const sent: Sent = [];
  let onUpdateFound = () => {};
  const registration = {
    active: active ? {} : null,
    installing: already,
    addEventListener: (_type: "updatefound", handler: () => void) => void (onUpdateFound = handler),
  };
  const onWaiting = vi.fn();
  watchInstalls(registration, { track: (name, data) => void sent.push([name, data]), onWaiting, isOnline: () => online });
  const found = () => {
    const worker = fakeWorker();
    registration.installing = worker;
    onUpdateFound();
    return worker;
  };
  return { sent, found, onWaiting };
}

describe("watched installs", () => {
  it("offers a worker that installs next to an active one", () => {
    const { found, onWaiting } = installs();
    found().become("installed");
    expect(onWaiting).toHaveBeenCalledOnce();
  });

  it("doesn't offer a first install", () => {
    const { found, onWaiting } = installs(null, { active: false });
    found().become("installed");
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("still offers a later worker after one failed to install", () => {
    const { found, onWaiting, sent } = installs();
    found().become("redundant");
    found().become("installed");
    expect(sent.map(([n]) => n)).toEqual(["pwa-update-install-failed"]);
    expect(onWaiting).toHaveBeenCalledOnce();
  });

  it("watches a worker that was already installing when watching started", () => {
    const worker = fakeWorker();
    const { sent } = installs(worker);
    worker.become("redundant");
    expect(sent).toEqual([["pwa-update-install-failed", { isUpdate: true, online: true }]]);
  });

  it("reports a new worker that fails to install", () => {
    const { sent, found } = installs();
    found().become("redundant");
    expect(sent).toEqual([["pwa-update-install-failed", { isUpdate: true, online: true }]]);
  });

  it("tells a first install and an offline player apart from a broken update", () => {
    const first = installs(null, { active: false });
    first.found().become("redundant");
    const offline = installs(null, { online: false });
    offline.found().become("redundant");
    expect([...first.sent, ...offline.sent]).toEqual([
      ["pwa-update-install-failed", { isUpdate: false, online: true }],
      ["pwa-update-install-failed", { isUpdate: true, online: false }],
    ]);
  });

  it("stays quiet for a worker that installs, even if a newer one replaces it later", () => {
    const { sent, found } = installs();
    const worker = found();
    worker.become("installed");
    worker.become("redundant");
    expect(sent).toEqual([]);
  });

  it("reports at most once per session", () => {
    const { sent, found } = installs();
    found().become("redundant");
    found().become("redundant");
    expect(sent).toHaveLength(1);
  });
});

describe("reloading once the new worker has activated", () => {
  function uncontrolled(waiting: ReturnType<typeof fakeWorker> | null) {
    const updateSW = vi.fn(() => Promise.resolve());
    const reload = vi.fn();
    return { updateSW, reload, apply: reloadOnceActivated(updateSW, () => waiting, reload) };
  }

  it("reloads as soon as the waiting worker has activated", async () => {
    const worker = fakeWorker();
    worker.state = "installed";
    const { updateSW, reload, apply } = uncontrolled(worker);
    void apply();
    await settle();
    expect(updateSW).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    worker.become("activating");
    await settle();
    expect(reload).not.toHaveBeenCalled();
    worker.become("activated");
    await settle();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads at once when no worker is waiting any more", async () => {
    const { reload, apply } = uncontrolled(null);
    await apply();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("leaves a worker that never activates to the fallback", async () => {
    const worker = fakeWorker();
    worker.state = "installed";
    const { reload, apply } = uncontrolled(worker);
    void apply();
    worker.become("redundant");
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });
});
