/*
KWin Script Floating Tiles
(C) 2021 Natalie Clarius <natalie_clarius@yahoo.de>
GNU General Public License v3.0
*/


///////////////////////
// configuration
///////////////////////

const config = {
    // whether to automatically restore automatically minimized windows
    autoRestore:   readConfig("autoRestore",   true),
    // whether to permit windows to be covered by non-normal windows
    ignoreNonnormal: readConfig("ignoreNonnormal", false),
    ignoreTransient: readConfig("ignoreTransient", true),
    // excluded/included applications
    excludeMode: readConfig("excludeMode", true),
    excludedAppsForeground: readConfig("excludedAppsForeground", "plasmashell, krunner")
        .split(/,\s|,/),
    excludedAppsBackground: readConfig("excludedAppsBackground", "")
        .split(/,\s|,/),
    includeMode: readConfig("includeMode", false),
    includedAppsForeground: readConfig("includedAppsForeground", "")
        .split(/,\s|,/),
    includedAppsBackground: readConfig("includedAppsBackground", "")
        .split(/,\s|,/),
};


///////////////////////
// initialization
///////////////////////

const debugMode = readConfig("debugMode", true);
const fullDebugMode = readConfig("fullDebugMode", false);
function debug(...args) {if (debugMode) {console.debug("floatingtiles:", ...args);}}
function fulldebug(...args) {if (fullDebugMode) {console.debug("floatingtiles:", ...args);}}
debug("initializing");
debug("auto restore:", config.autoRestore);
debug("ignore non-normal:", config.ignoreNonnormal,
      "ignore transient:", config.ignoreTransient);
debug("exclude (fg, bg):", config.excludeMode,
      config.excludedAppsForeground, config.excludedAppsBackground);
debug("include (fg, bg):", config.includeMode,
      config.includedAppsForeground, config.includedAppsBackground);
console.debug("");


///////////////////////
// bookkeeping
///////////////////////

// keep track of added windows
var added = [];

// keep track of active windows
var active = [];

// remove other occurrences and add client to top of stack of active
function addActive(client) {
    if (!restored.includes(client)) {
        removeActive(client);
        active.unshift(client);
    }
}

// remove client from stack of active
function removeActive(client) {
    active = active.filter(entry => entry != client);
}

// keep track of minimized windows
var minimized = [];

// remove other occurrences and add client to top of stack of minimized
function addMinimized(client) {
    removeMinimized(client);
    minimized.unshift(client);
}

// remove client from stack of minimized
function removeMinimized(client) {
    minimized = minimized.filter(entry => entry != client);
}

// remove client from stack of to be restored
// if has been manually rather than automatically been minimized
// since it is not the most recent entry on the minimized stack
// todo doesn't work with minimize all
function resetMinimized(client) {
    if (minimized[0] != client) {
        removeMinimized(client);
    }
}

// keep track of restored windows
var restored = [];

// keep track of removed windows
var removed = false;


///////////////////////
// set up triggers
///////////////////////

// trigger minimize and restore
// when client is initially present, added or activated
workspace.clientList().forEach(client => onActivated(client));
workspace.clientAdded.connect(onActivated);
workspace.clientActivated.connect(onActivated);
function onActivated(client) {
    if (!client) return;
    if (undoAutoReactivate(client)) return;
    debug("activated", caption(client));
    fulldebug(properties(client));
    addActive(client);
    removeMinimized(client);
    minimizeOverlapping(client);
    debug("");
}

// add to watchlist on added and trigger minimize and restore
// when client is moved or resized or screen geometry changes
workspace.clientList().forEach(client => onAdded(client));
workspace.clientAdded.connect(onAdded);
function onAdded(client) {
    debug("added", caption(client));
    fulldebug(properties(client));
    added = [client];
    debug("");
    client.geometryChanged.connect(onRegeometrized);
    client.clientGeometryChanged.connect(onRegeometrized);
    client.frameGeometryChanged.connect(onRegeometrized);
    client.clientFinishUserMovedResized.connect(onRegeometrized);
    client.moveResizedChanged.connect(onRegeometrized);
    client.fullScreenChanged.connect(onRegeometrized);
    client.clientMaximizedStateChanged.connect(onRegeometrized);
    client.screenChanged.connect(onRegeometrized);
    client.desktopChanged.connect(onRegeometrized);
    // workspace.currentDesktopChanged.connect(onRegeometrized);
    workspace.numberScreensChanged.connect(onRegeometrized);
    workspace.screenResized.connect(onRegeometrized);
    workspace.virtualScreenSizeChanged.connect(onRegeometrized);
    workspace.virtualScreenGeometryChanged.connect(onRegeometrized);
    if (client.dock) workspace.clientList().forEach(client =>
        onRegeometrized(client));
}

function onRegeometrized(client) {
    // don't act on windows that are still undergoing geometry change
    if (!client || client.move || client.resize) return;
    debug("regeometrized", caption(client));
    fulldebug(properties(client));
    removeMinimized(client);
    minimizeOverlapping(client);
    restoreMinimized(client);
    debug("");
}

// trigger minimize, restore and reactivate
// when client minimized
workspace.clientMinimized.connect(onMinimized);
function onMinimized(client) {
    debug("minimized", caption(client));
    fulldebug(properties(client));
    resetMinimized(client);
    if (!minimized.includes(client)) { // manually minimized
        removeActive(client);
        reactivateRecent();
    }
    restoreMinimized(client);
    if (!minimized.includes(client)) { // manually minimized
        reactivateRecent();
    }
    debug("");
}

// trigger minimize, restore and reactivate
// when client is closed
workspace.clientRemoved.connect(onRemoved);
function onRemoved(client) {
    debug("closed", caption(client));
    fulldebug(properties(client));
    removeActive(client);
    removeMinimized(client);
    restoreMinimized(client);
    reactivateRecent();
    removed = true;
    debug("");
}


///////////////////////
// minimize, restore and reactivate
///////////////////////

// minimize all windows overlapped by active window
function minimizeOverlapping(active) {
    // if no window is provided, try the active window, if that fails too, abort
    if (!active) active = workspace.activeClient;
    if (!active) return;
    debug("apply minimize for", caption(active));
    fulldebug(properties(active));

    // check for overlap with other windows
    var others = workspace.clientList();
    for (var i = 0; i < others.length; i++) {
        var other = others[i];
        fulldebug("check minimize", caption(other));
        fulldebug(properties(other));
        if (overlap(active, other) && !other.minimized) {
            // overlap with a relevant unminimized window: minimize other window
            debug("minimizing", caption(other));
            addMinimized(other);
            other.minimized = true;
        }
    }
}

// restore all previously minimized windows that are now no longer overlapping
function restoreMinimized(active) {
    // don't restore if auto-restore is disabled
    if (!config.autoRestore) return;
    debug("apply restore for", caption(active));
    fulldebug(properties(active));

    // iterate minimized windows
    minimized = minimized.filter(client => client && client.minimized);
    var restorable = minimized.filter(client =>
        (client.desktop == workspace.currentDesktop || client.onAllDesktops));
    for (var i = 0; i < restorable.length; i++) {
        var inactive = restorable[i];
        if (!inactive) continue;
        debug("check restore", caption(inactive));
        fulldebug(properties(inactive));

        // check for overlap with other windows
        var noOverlap = true;
        var others = workspace.clientList();
        for (var j = 0; j < others.length; j++) {
            var other = others[j];
            fulldebug("check prevent restore for", caption(other));
            fulldebug(properties(other));
            if ((overlap(inactive, other) || overlap(other, inactive))
                && ((!other.minimized) || restored.includes(other))) {
                // overlap with a relevant unminimized or to be so window:
                // don't restore current window
                debug("not restoring for", caption(other));
                noOverlap = false;
                break;
            }
        }

        if (noOverlap) {
            // window no longer overlaps with any others:
            // mark for restoration
            debug("restoring", caption(inactive));
            restored.push(inactive);
        }
    }

    // restore all windows marked as such
    for (var i = 0; i < restored.length; i++) {
        var inactive = restored[i];
        removeMinimized(inactive);
        inactive.minimized = false;
    }
    restored = [];
}

// reactivate the most recently avtive client if there is not already one
function reactivateRecent() {
    // get reactivable clients on current desktop
    debug("apply reactivate recent");
    var reactivable = active.filter(client =>
        (client.desktop == workspace.currentDesktop || client.onAllDesktops
        && !client.minimized));
    fulldebug("reactivable:", reactivable.map(client => properties(client)));
    if (reactivable.length == 0) return false;
    // activate most recent client on the stack
    var recentActive = reactivable[0];
    if (!recentActive) return false;
    debug("reactivating recent active", caption(recentActive));
    workspace.activeClient = recentActive;
    return true;
}

// undo the most recent activation
// if a client has automatically been wrongly reactivated
// after another has been removed
function undoAutoReactivate(client) {
    return;
    debug("apply undo auto reactivate");
    if (removed) {
        removed = false;
        if (client.normalWindow || client.desktopWindow) {
            debug("undoing auto reactivate", caption(client));
            fulldebug(properties(client));
            return reactivateRecent();
        }
        return false;
    }
}


///////////////////////
// compute overlap
///////////////////////

function overlap(win1, win2) {
    return !ignoreOverlap(win1, win2)
        && overlapHorizontal(win1, win2)
        && overlapVertical(win1, win2);
}

function overlapHorizontal(win1, win2) {
    return (win1.x <= win2.x && win1.x + win1.width > win2.x)
        || (win2.x <= win1.x && win2.x + win2.width > win1.x);
}

function overlapVertical(win1, win2) {
    return (win1.y <= win2.y && win1.y + win1.height > win2.y)
        || (win2.y <= win1.y && win2.y + win2.height > win1.y);
}

// specify cases where not to minimize despite overlap
function ignoreOverlap(front, back) {
    return back == front // self
        || !(back.desktop == front.desktop || // different desktop
             back.onAllDesktops || front.onAllDesktops)
        || [front, back].some(win =>  // desktop element
             win.desktopWindow || win.dock || win.onScreenDisplay ||
             win.notification || win.criticalNotification)
        || (config.ignoreNonnormal // non-normal window
            && [front, back].some(win => !win.normalWindow))
        || (config.ignoreTransient
            // transient window belonging to the same main window
            && [front, back].some(win => win.transient)
            && ((front.transient && front.transientFor == back)
             || (back.transient && back.transientFor == front)
             || (front.transient && back.transient
              && front.transientFor == back.transientFor)))
        || (config.excludeMode // excluded program
            && (config.excludedAppsForeground.
                    includes(String(front.resourceClass))
             || config.excludedAppsBackground.
                    includes(String(back.resourceClass))))
        || (config.includeMode // non-included program
            && ! (config.includedAppsForeground
                    .includes(String(front.resourceClass))
               || config.includedAppsBackground
                    .includes(String(back.resourceClass))))
}


///////////////////////
// helpers
///////////////////////

// stringify client object
function properties(client) {
    return JSON.stringify(client, undefined, 2);
}

// stringify client caption
function caption(client) {
    return client ? client.caption : client;
}
