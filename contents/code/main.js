/*
KWin Script Floating Tiles
(C) 2021 Natalie Clarius <natalie_clarius@yahoo.de>
GNU General Public License v3.0
*/

///////////////////////
// configuration
///////////////////////

const config = {
    // whether to automatically restore minimized windows
    autoRestore: readConfig("autoRestore", true),

    // whether to not prevent windows from being covered by special windows such as panel popouts or krunner
    ignoreSpecial: readConfig("ignoreSpecial", true)
};

///////////////////////
// setup
///////////////////////

// add to watchlist when client is initially present or added
for (const client of workspace.clientList()) {
    onAdded(client);
}
workspace.clientAdded.connect(onAdded);
function onAdded(client) {
    client.geometryChanged.connect(onMovedResized);
    client.clientFinishUserMovedResized.connect(onMovedResized);
}

// trigger minimize and restore when client is added or activated
workspace.clientAdded.connect(onActivated);
workspace.clientActivated.connect(onActivated);
function onActivated(client) {
    if (client == null) {
        return;
    }
    removeMinimized(client);
    minimizeOverlapping();
    restoreMinimized();
}

// trigger minimize and restore when client is moved or resized
function onMovedResized(client) {
    minimizeOverlapping();
    restoreMinimized();
}

// trigger minimize, restore and reactivate when client minimized
workspace.clientMinimized.connect(onMinimized);
function onMinimized(client) {
    resetMinimized(client);
    restoreMinimized();
    reactivate();
}

// trigger minimize, restore and reactivate when client is closed
workspace.clientRemoved.connect(onRemoved);
function onRemoved(client) {
    removeMinimized(client);
    restoreMinimized();
    reactivate();
}

///////////////////////
// bookkeeping
///////////////////////

// keep track of minimized windows
var minimized = [];

// remove other occurrences and add client to beginning of list of minimized
function addMinimized(client) {
    removeMinimized(client);
    minimized.unshift(client);
}

// remove client from list of minimized
function removeMinimized(client) {
    minimized = minimized.filter(entry => entry != client);
}

// remove client from list of minimized if it was not most recently minimized automatically
function resetMinimized(client) {
    if (minimized[0] != client) {
        removeMinimized(client);
    }
}

///////////////////////
// minimize, restore and reactivate
///////////////////////

// minimize all windows overlapped by active window
function minimizeOverlapping() {
    // get active window
    active = workspace.activeClient;
    // don't act on windows that are dead or still undergoing geometry change
    if (active == undefined || active == null || active.move || active.resize) {
        return;
    }

    // check for overlap with other windows
    for (const other of workspace.clientList()) {
        if (overlap(active, other)) {
            // overlap: minimize other window
            other.minimized = true;
            addMinimized(other);
        }
    }
}

// restore all previously minimized windows that are now no longer overlapping
function restoreMinimized() {
    // don't restore if auto-restore is disabled
    if (!config.autoRestore) {
        return;
    }

    // iterate minimized windows
    for (const inactive of minimized) {
        // remove dead clients from to be restored windows
        if (inactive == undefined || inactive == null || !workspace.clientList().includes(inactive)) {
            removeMinimized(inactive);
            continue;
        }

        // check for overlap with other windows
        noOverlap = true;
        for (const other of workspace.clientList()) {
            if (overlap(inactive, other)) {
                // overlap: don't restore current window
                noOverlap = false;
                break;
            }
        }

        if (noOverlap) {
            // window no longer overlaps with any others: restore
            inactive.minimized = false;
            removeMinimized(inactive);
        }
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
        // activate most recent client in the list
        workspace.activeClient = unminimized[0];
    }
}

///////////////////////
// compute overlap
///////////////////////

function overlap(win1, win2) {
    return !ignoreOverlap(win1, win2)
            && overlapHorizontal(win1, win2) && overlapVertical(win1, win2);
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
        || back.minimized // already minimized
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
