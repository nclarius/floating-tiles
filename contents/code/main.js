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
    autoRestore: readConfig("autoRestore", true),
    // whether to permit windows to be covered by special windows such as panel popouts or krunner
    ignoreSpecial: readConfig("ignoreSpecial", true)
};


///////////////////////
// initialization
///////////////////////

debugMode = true;
function debug(...args) {if (debugMode) {console.debug(...args);}}
debug("initializing floating tiles");
debug("floating tiles settings:", "auto restore:", config.autoRestore, "ignore special:", config.ignoreSpecial);


///////////////////////
// bookkeeping
///////////////////////

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

// remove client from stack of minimized if it is not the most recent entry on the minimized stack (and has therefore been manually rather than automatically been minimized)
// todo doesn't work with minimize all
function resetMinimized(client) {
    if (minimized[0] != client) {
        removeMinimized(client);
    }
}


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
    removeMinimized(client);
    minimizeOverlapping();
    restoreMinimized();
}

// trigger minimize and restore when client is moved or resized
workspace.clientList().forEach(client => onAdded(client));
workspace.clientAdded.connect(onAdded);
function onAdded(client) {
    debug("\nadded", client.caption);
    client.geometryChanged.connect(onRegeometrized);
    client.clientFinishUserMovedResized.connect(onRegeometrized);
    client.screenChanged.connect(onRegeometrized);
    client.desktopChanged.connect(onRegeometrized);
}

function onRegeometrized(client) {
    debug("\nregeometrized", client ? client.caption : client);
    removeMinimized(client);
    minimizeOverlapping();
    restoreMinimized();
}

// trigger minimize, restore and reactivate when client minimized
workspace.clientMinimized.connect(onMinimized);
function onMinimized(client) {
    debug("\nminimized", client ? client.caption : client);
    resetMinimized(client);
    restoreMinimized();
    reactivate();
}

// trigger minimize, restore and reactivate when client is closed
workspace.clientRemoved.connect(onRemoved);
function onRemoved(client) {
    debug("\nclosed", client ? client.caption : client);
    removeMinimized(client);
    restoreMinimized();
    reactivate();
}


///////////////////////
// minimize, restore and reactivate
///////////////////////

// minimize all windows overlapped by active window
function minimizeOverlapping() {
    // get active window
    active = workspace.activeClient;
    // don't act on windows that are dead or still undergoing geometry change
    if (active == undefined || active == null || active.move || active.resize) return;
    debug("try minimize for", active.caption);

    // check for overlap with other windows
    const clients = workspace.clientList();
    for (var i = 0; i < clients.length; i++) {
        other = clients[i];
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
    if (!config.autoRestore) return;

    // iterate minimized windows
    var toRestore = [];
    for (var i = 0; i < minimized.length; i++) {
        inactive = minimized[i];
        debug("try restore", inactive.caption);
        // remove dead clients from to be restored windows
        if (inactive == undefined || inactive == null || !workspace.clientList().includes(inactive)) {
            debug("removing ghost", inactive.caption);
            removeMinimized(inactive);
            continue;
        }

        // check for overlap with other windows
        noOverlap = true;
        var others = workspace.clientList();
        for (var j = 0; j < others.length; j++) {
            other = others[j];
            if (overlap(inactive, other) && (!other.minimized || toRestore.includes(other))) {
                // overlap with a relevant unminimized or to be unminimized window: don't restore current window
                debug("don't restore for", other.caption);
                noOverlap = false;
                break;
            }
        }

        if (noOverlap) {
            // window no longer overlaps with any others: mark for restoration
            debug("restoring", inactive.caption);
            toRestore.push(inactive);
        }
    }

    // restore all windows marked as such
    for (var i = 0; i < toRestore.length; i++) {
        inactive = toRestore[i];
        removeMinimized(inactive);
        inactive.minimized = false;
    }
}

// reactivate the most recent client if there are unminimized but no active clients
function reactivate() {
    // get unminimized clients on current desktop
    unminimized = workspace.clientList().filter(client =>
           client.normalWindow
        && !client.minimized
        && (client.desktop == workspace.currentDesktop || client.desktop == -1));
    // check if there is no active client but unminimized ones
    if ((workspace.activeClient == null || workspace.activeClient.desktopWindow)
    && unminimized.length > 0) {
        // activate most recent client on the stack
        mostRecent = unminimized[0];
        debug("reactivating", mostRecent.caption);
        workspace.activeClient = mostRecent;
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
    return back == front  // self
        || !(back.desktop == front.desktop
             || back.desktop == -1 || front.desktop == -1) // different desktop
        || front.desktopWindow || back.desktopWindow // desktop background
        || front.dock || back.dock // panel
        || (!front.normalWindow
            && String(front.resourceClass) == String(back.resourceClass)) // special window associated with toplevel
        || (config.ignoreSpecial
            && (!front.normalWindow || front.resourceClass == "krunner")) // special window
        || (front.resourceClass == "zoom" && front.caption == "zoom") // zoom special window
        || front.resourceClass == "kruler"; // kruler
}
