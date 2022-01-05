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
    aurestored:   readConfig("aurestored",   true),
    // whether to permit windows to be covered by special windows such as panel popouts or krunner
    ignoreSpecial: readConfig("ignoreSpecial", true),
    // excluded/included applications
    excludeMode: readConfig("excludeMode", true),
    excludedAppsForeground: readConfig("excludedAppsForeground", "").split(", "),
    excludedAppsBackground: readConfig("excludedAppsBackground", "").split(", "),
    includeMode: readConfig("includeMode", false),
    includedAppsForeground: readConfig("includedAppsForeground", "").split(", "),
    includedAppsBackground: readConfig("includedAppsBackground", "").split(", ")
};


///////////////////////
// initialization
///////////////////////

debugMode = false;
function debug(...args) {if (debugMode) {console.debug(...args);}}
debug("initializing floating tiles");
debug("floating tiles settings:", "auto restore:", config.aurestored, "ignore special:", config.ignoreSpecial);
debug("exclude:", config.excludeMode, config.excludedAppsForeground, config.excludedAppsBackground);
debug("include:", config.includeMode, config.includedAppsForeground, config.includedAppsBackground);


///////////////////////
// bookkeeping
///////////////////////

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

// keep track of added windows
var recentAdded = workspace.activeClient;


///////////////////////
// set up triggers
///////////////////////

// trigger minimize and restore when client is initially present, added or activated
workspace.clientList().forEach(client => onActivated(client));
workspace.clientAdded.connect(onActivated);
workspace.clientActivated.connect(onActivated);
function onActivated(client) {
    if (client == null) return;
    debug("\nactivated", client.caption);
    addActive(client);
    removeMinimized(client);
    minimizeOverlapping(client);
    reactivateAdded();
    restoreMinimized();
}

// add to watchlist on added and trigger minimize and restore when client is moved or resized or screen geometry changes
workspace.clientList().forEach(client => onAdded(client));
workspace.clientAdded.connect(onAdded);
function onAdded(client) {
    debug("\nadded", client.caption);
    // remember active client
    recentAdded = client;
    client.moveResizedChanged.connect(onRegeometrized);
    client.geometryChanged.connect(onRegeometrized);
    client.clientGeometryChanged.connect(onRegeometrized);
    client.frameGeometryChanged.connect(onRegeometrized);
    client.clientFinishUserMovedResized.connect(onRegeometrized);
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
    debug("\nregeometrized", client && client.caption ? client.caption : client);
    removeMinimized(client);
    minimizeOverlapping(client);
    restoreMinimized();
}

// trigger minimize, restore and reactivate when client minimized
workspace.clientMinimized.connect(onMinimized);
function onMinimized(client) {
    debug("\nminimized", client ? client.caption : client);
    resetMinimized(client);
    if (!minimized.includes(client)) { // manually minimized
        removeActive(client);
        reactivateRemoved();
    }
    restoreMinimized();
}

// trigger minimize, restore and reactivate when client is closed
workspace.clientRemoved.connect(onRemoved);
function onRemoved(client) {
    debug("\nclosed", client ? client.caption : client);
    removeActive(client);
    removeMinimized(client);
    reactivateRemoved();
    restoreMinimized();
}


///////////////////////
// minimize, restore and reactivate
///////////////////////

// minimize all windows overlapped by active window
function minimizeOverlapping(active) {
    // if no window is provided, set default to the active window
    if (active == null || active == undefined) active = workspace.activeClient;
    // don't act on windows that are dead or still undergoing geometry change
    if (active == undefined || active == null || active.move || active.resize) return;
    debug("try minimize for", active.caption);

    // check for overlap with other windows
    var others = workspace.clientList();
    for (var i = 0; i < others.length; i++) {
        other = others[i];
        if (overlap(active, other) && !other.minimized) {
            // overlap with a relevant unminimized window: minimize other window
            debug("minimizing", other.caption);
            addMinimized(other);
            other.minimized = true;
        }
    }
}

// restore all previously minimized windows that are now no longer overlapping
function restoreMinimized() {
    // don't restore if auto-restore is disabled
    if (!config.aurestored) return;

    // iterate minimized windows
    minimized = minimized.filter(client => client != undefined);
    for (var i = 0; i < minimized.length; i++) {
        inactive = minimized[i];
        debug("try restore", inactive.caption);

        // check for overlap with other windows
        noOverlap = true;
        var others = workspace.clientList();
        for (var j = 0; j < others.length; j++) {
            other = others[j];
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
        inactive = restored[i];
        removeMinimized(inactive);
        inactive.minimized = false;
    }
    restored = [];
}

// ensure added window remains active
function reactivateAdded() {
    if (recentAdded == undefined || recentAdded == null) return;
    if (workspace.activeClient != recentAdded) {
       debug("reactivating recent added", recentAdded, recentAdded.caption, recentAdded == undefined, recentAdded == null);
       workspace.activeClient = recentAdded;
    }
    recentAdded = undefined;
}

// reactivate the most recent active client after another has been removed
function reactivateRemoved() {
    // get reactivable clients on current desktop
    active = active.filter(client => client != undefined);
    reactivable = active.filter(client =>
        (client.desktop == workspace.currentDesktop || client.onAllDesktops));
    if (reactivable.length == 0) return;
    // activate most recent client on the stack
    recentActive = reactivable[0];
    debug("reactivating recent active", recentActive.caption);
    workspace.activeClient = recentActive; // todo: doesn't work; immediately afterwards active client is null
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
    return back == front  // self
        || (config.excludeMode // excluded program
            && (config.excludedAppsForeground.includes(String(front.resourceClass))
            || config.excludedAppsBackground.includes(String(back.resourceClass))))
        || (config.includeMode // non-included program
            && ! (config.includedAppsForeground.includes(String(front.resourceClass))
            || config.includedAppsBackground.includes(String(back.resourceClass))))
        || !(back.desktop == front.desktop
             || back.onAllDesktops || front.onAllDesktops) // different desktop
        || front.desktopWindow || back.desktopWindow // desktop background
        || front.dock || back.dock // panel
        || ((!front.normalWindow
            && String(front.resourceClass) == String(back.resourceClass))
         || (String(front.resourceClass) == "dolphin"
            && (String(front.resourceName).startsWith("Copying") || String(front.resourceName).startsWith("Moving")) || String(front.resourceName).startsWith("Progress Dialog"))) // special window associated with toplevel
        || (config.ignoreSpecial
            && (!front.normalWindow || String(front.resourceClass) == "krunner")) // special window
        || ["zoom", "kruler"].includes(String(front.resourceClass)); // excepted program
}
