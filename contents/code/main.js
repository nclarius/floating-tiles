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
    ignoreSpecial: readConfig("ignoreSpecial", true),
    // excluded/included applications
    excludeMode: readConfig("excludeMode", true),
    excludedAppsForeground: readConfig("excludedAppsForeground", "").split(/,\s|,/),
    excludedAppsBackground: readConfig("excludedAppsBackground", "").split(/,\s|,/),
    includeMode: readConfig("includeMode", false),
    includedAppsForeground: readConfig("includedAppsForeground", "").split(/,\s|,/),
    includedAppsBackground: readConfig("includedAppsBackground", "").split(/,\s|,/)
};


///////////////////////
// initialization
///////////////////////

debugMode = true;
function debug(...args) {if (debugMode) {console.debug("Floating Tiles:", ...args);}}
debug("initializing");
debug("auto restore:", config.autoRestore);
debug("ignore (non-normal, transient, special):", config.ignoreNonnormal, config.ignoreTransient, config.ignoreSpecial);
debug("exclude (fg, bg):", config.excludeMode, config.excludedAppsForeground, config.excludedAppsBackground);
debug("include (fg, bg):", config.includeMode, config.includedAppsForeground, config.includedAppsBackground);
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

// remove client from stack of to be restored if has been manually rather than automatically been minimized since it is not the most recent entry on the minimized stack
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

// trigger minimize and restore when client is initially present, added or activated
workspace.clientList().forEach(client => onActivated(client));
workspace.clientAdded.connect(onActivated);
workspace.clientActivated.connect(onActivated);
function onActivated(client) {
    if (client == null || client == undefined) return;
    if (undoAutoReactivate(client)) return;
    debug("activated", client.caption);
    addActive(client);
    removeMinimized(client);
    minimizeOverlapping(client);
    debug("");
}

// add to watchlist on added and trigger minimize and restore when client is moved or resized or screen geometry changes
workspace.clientList().forEach(client => onAdded(client));
workspace.clientAdded.connect(onAdded);
function onAdded(client) {
    debug("added", client.caption);
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
    workspace.currentDesktopChanged.connect(onRegeometrized);
    workspace.numberScreensChanged.connect(onRegeometrized);
    workspace.screenResized.connect(onRegeometrized);
    workspace.virtualScreenSizeChanged.connect(onRegeometrized);
    workspace.virtualScreenGeometryChanged.connect(onRegeometrized);
    if (client.dock) workspace.clientList().forEach(client => onRegeometrized(client));
}
function onRegeometrized(client) {
    // don't act on windows that are still undergoing geometry change
    if (client == null || client == undefined || client.caption == "Plasma" || client.move || client.resize) return;
    debug("regeometrized", client.caption);
    removeMinimized(client);
    minimizeOverlapping(client);
    restoreMinimized(client);
    debug("");
}

// trigger minimize, restore and reactivate when client minimized
workspace.clientMinimized.connect(onMinimized);
function onMinimized(client) {
    debug("minimized", client && client.caption ? client.caption : client);
    resetMinimized(client);
    if (!minimized.includes(client)) { // manually minimized
        removeActive(client);
    }
    restoreMinimized(client);
    debug("");
}

// trigger minimize, restore and reactivate when client is closed
workspace.clientRemoved.connect(onRemoved);
function onRemoved(client) {
    debug("closed", client && client.caption ? client.caption : client);
    removeActive(client);
    removeMinimized(client);
    restoreMinimized(client);
    removed = true;
    debug("");
}


///////////////////////
// minimize, restore and reactivate
///////////////////////

// minimize all windows overlapped by active window
function minimizeOverlapping(active) {
    // if no window is provided, try the active window, if that fails too abort
    if (active == null || active == undefined) active = workspace.activeClient;
    if (active == undefined || active == null) return;
    debug("try minimize for", active.caption);

    // check for overlap with other windows
    var others = workspace.clientList();
    for (var i = 0; i < others.length; i++) {
        var other = others[i];
        if (overlap(active, other) && !other.minimized) {
            // overlap with a relevant unminimized window: minimize other window
            debug("minimizing", other.caption);
            addMinimized(other);
            other.minimized = true;
        }
    }
}

// restore all previously minimized windows that are now no longer overlapping
function restoreMinimized(trigger) {
    // don't restore if auto-restore is disabled
    if (!config.autoRestore) return;
    debug("try restore for", trigger.caption);

    // iterate minimized windows
    minimized = minimized.filter(client => client != null && client != undefined
        && client.minimized);
    var restorable = minimized.filter(client =>
        (client.desktop == workspace.currentDesktop || client.onAllDesktops));
    for (var i = 0; i < restorable.length; i++) {
        var inactive = restorable[i];
        debug("try restore", inactive.caption);

        // check for overlap with other windows
        var noOverlap = true;
        var others = workspace.clientList();
        for (var j = 0; j < others.length; j++) {
            var other = others[j];
            if ((overlap(inactive, other) || overlap(other, inactive)) && ((!other.minimized) || restored.includes(other))) {
                // overlap with a relevant unminimized or to be unminimized window: don't restore current window
                debug("don't restore for", other.caption);
                noOverlap = false;
                break;
            }
        }

        if (noOverlap) {
            // window no longer overlaps with any others: mark for restoration
            debug("restoring", inactive.caption);
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

    // reactivate the most recent active client
    reactivateRecent();
}

// reactivate the most recent active client after another has been removed
function reactivateRecent() {
    debug("checking to reactivate recent active");
    // get reactivable clients on current desktop
    var reactivable = active.filter(client =>
        (client.desktop == workspace.currentDesktop || client.onAllDesktops));
    if (reactivable.length == 0) return;
    // activate most recent client on the stack
    var recentActive =  reactivable[0];
    debug("reactivating recent active", recentActive.caption);
    workspace.activeClient = recentActive;
}

// undo the most recent activation if a client has automatically been wrongly reactivated after another has been removed
function undoAutoReactivate(client) {
    if (removed) {
        removed = false;
        if (client.normallWindow || client.desktopWindow) {
            debug("undo auto reactivate", client.caption);
            reactivateRecent();
            return true;
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
        || !(back.desktop == front.desktop // different desktop
             || back.onAllDesktops || front.onAllDesktops)
        || [front, back].some(w => w.desktopWindow || w.dock || w.notification || w.criticalNotification || w.onScreenDisplay) // desktop element
        || (config.ignoreNonnormal && [front, back].some(win => !win.normalWindow))
        || (config.ignoreTransient && [front, back].some(win => win.transient) && // transient window belonging to the same main window
            ((front.transient && front.transientFor == back)
             || (back.transient && back.transientFor == front)
             || (front.transient && back.transient && front.transientFor == back.transientFor)))
        || (config.ignoreSpecial && [front, back].some(win => win.specialWindow || win.resourceClass == "krunner"))
        || (config.excludeMode // excluded program
            && (config.excludedAppsForeground.includes(String(front.resourceClass))
                || config.excludedAppsBackground.includes(String(back.resourceClass))))
        || (config.includeMode // non-included program
            && ! (config.includedAppsForeground.includes(String(front.resourceClass))
                || config.includedAppsBackground.includes(String(back.resourceClass))))
}
