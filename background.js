// Runs in the background, even when the popup is closed.

const HEAT_YELLOW_DAYS = 3
const HEAT_RED_DAYS = 7
const ALARM_NAME = "checkLeads"
const RANK = { green: 0, yellow: 1, red: 2 }

function daysSince(timestamp) {
    return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24))
}

function getHeat(timestamp) {
    const days = daysSince(timestamp)
    if (days >= HEAT_RED_DAYS) return "red"
    if (days >= HEAT_YELLOW_DAYS) return "yellow"
    return "green"
}

const DEFAULT_SETTINGS = { notifications: true, dailyReminder: true, sync: true }

async function checkLeads() {
    const data = await chrome.storage.local.get(["myLeads", "notified", "settings", "lastReminderDay"])
    const leads = data.myLeads || []
    const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings)
    const notified = data.notified || {}
    const newNotified = {}
    const alerts = []
    let redCount = 0

    for (const lead of leads) {
        const heat = getHeat(lead.lastTouched)
        if (heat === "red") redCount++
        if (heat === "green") continue

        const previous = notified[lead.id] || "green"
        if (RANK[heat] > RANK[previous]) {
            alerts.push({ title: lead.title, heat: heat })
        }
        newNotified[lead.id] = heat
    }

    await chrome.storage.local.set({ notified: newNotified })

    await chrome.action.setBadgeText({ text: redCount > 0 ? String(redCount) : "" })
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" })

    if (!settings.notifications) return   // notifications turned off: badge only

    const today = new Date().toDateString()

    // 1) a lead just got colder: tell the user (once per colour change)
    if (alerts.length === 1) {
        const a = alerts[0]
        chrome.notifications.create("leadmemo-followup", {
            type: "basic",
            iconUrl: "icon.png",
            title: a.heat === "red" ? "Follow up now" : "Lead is getting cold",
            message: a.title
        })
        await chrome.storage.local.set({ lastReminderDay: today })
    } else if (alerts.length > 1) {
        chrome.notifications.create("leadmemo-followup", {
            type: "basic",
            iconUrl: "icon.png",
            title: "LeadMemo",
            message: alerts.length + " leads need your follow-up"
        })
        await chrome.storage.local.set({ lastReminderDay: today })
    }
    // 2) daily reminder: red leads still waiting, at most once a day
    else if (settings.dailyReminder && redCount > 0 && data.lastReminderDay !== today) {
        chrome.notifications.create("leadmemo-followup", {
            type: "basic",
            iconUrl: "icon.png",
            title: "Still waiting for follow-up",
            message: redCount + (redCount === 1 ? " lead is" : " leads are") + " still red. Open LeadMemo to contact them."
        })
        await chrome.storage.local.set({ lastReminderDay: today })
    }
}

function setupAlarm() {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 })
}

// ======================================================================
// Cloud sync with chrome.storage.sync
// - the popup keeps working on chrome.storage.local (fast, works offline)
// - every lead is also stored in the cloud as its own key: "lead_<id>"
// - when two devices changed the same lead, the NEWER updatedAt wins
// - a deleted lead leaves a small "tombstone" for 30 days, so the delete
//   reaches the other devices instead of the lead coming back
// ======================================================================
const SYNC_PREFIX = "lead_"
const TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000
let syncRunning = false
let syncAgain = false

function normalizeUrl(url) {
    let clean = String(url || "").trim().toLowerCase()
    clean = clean.replace(/^https?:\/\/(www\.)?/, "")
    clean = clean.split("#")[0]
    if (clean.endsWith("/")) clean = clean.slice(0, -1)
    return clean
}

// when was this lead last changed?
function stamp(lead) {
    return lead.updatedAt || lead.lastTouched || lead.createdAt || 0
}

// the exact shape saved in the cloud (fixed order, so comparing is reliable)
function pack(lead) {
    return {
        id: lead.id,
        url: lead.url,
        title: lead.title,
        note: lead.note || "",
        tag: lead.tag || "Other",
        createdAt: lead.createdAt,
        lastTouched: lead.lastTouched,
        contactCount: lead.contactCount || 0,
        updatedAt: stamp(lead)
    }
}

async function setSyncStatus(state, message) {
    await chrome.storage.local.set({ syncStatus: { state: state, at: Date.now(), message: message || "" } })
}

async function syncOnce() {
    const data = await chrome.storage.local.get(["myLeads", "deleted", "settings"])
    const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings)
    if (!settings.sync) {
        await setSyncStatus("off")
        return
    }

    const localLeads = data.myLeads || []
    const localDeleted = data.deleted || {}

    let remote
    try {
        remote = await chrome.storage.sync.get(null)
    } catch (error) {
        await setSyncStatus("error", "Could not reach sync. Will try again soon.")
        return
    }

    const now = Date.now()

    // 1) for every lead id, find the newest version (a lead or a delete)
    const best = {}
    function consider(id, rec) {
        const cur = best[id]
        if (!cur || rec.at > cur.at || (rec.at === cur.at && rec.gone)) best[id] = rec
    }
    for (const lead of localLeads) {
        consider(String(lead.id), { at: stamp(lead), lead: pack(lead) })
    }
    for (const [id, deletedAt] of Object.entries(localDeleted)) {
        consider(id, { at: deletedAt, gone: true })
    }
    for (const [key, value] of Object.entries(remote)) {
        if (!key.startsWith(SYNC_PREFIX) || !value) continue
        const id = key.slice(SYNC_PREFIX.length)
        if (value.deleted) consider(id, { at: value.updatedAt || 0, gone: true })
        else consider(id, { at: stamp(value), lead: pack(value) })
    }

    // 2) the same link saved on two devices: keep the newer one only
    const byUrl = {}
    for (const [id, rec] of Object.entries(best)) {
        if (rec.gone) continue
        const u = normalizeUrl(rec.lead.url)
        const other = byUrl[u]
        if (other === undefined) { byUrl[u] = id; continue }
        const keep = best[other].at >= rec.at ? other : id
        const drop = keep === other ? id : other
        best[drop] = { at: now, gone: true }
        byUrl[u] = keep
    }

    // 3) the merged result
    const mergedLeads = []
    const mergedDeleted = {}
    for (const [id, rec] of Object.entries(best)) {
        if (rec.gone) {
            if (now - rec.at < TOMBSTONE_MS) mergedDeleted[id] = rec.at   // old tombstones are dropped
        } else {
            mergedLeads.push(rec.lead)
        }
    }
    mergedLeads.sort(function (a, b) { return a.createdAt - b.createdAt })

    // 4) update this device (only if something changed)
    const newLocal = {}
    if (JSON.stringify(mergedLeads) !== JSON.stringify(localLeads.map(pack))) newLocal.myLeads = mergedLeads
    if (JSON.stringify(mergedDeleted) !== JSON.stringify(localDeleted)) newLocal.deleted = mergedDeleted

    if (newLocal.myLeads || newLocal.deleted) {
        // did the popup change something while we were working? then start again
        const check = await chrome.storage.local.get(["myLeads", "deleted"])
        if (JSON.stringify(check.myLeads || []) !== JSON.stringify(localLeads) ||
            JSON.stringify(check.deleted || {}) !== JSON.stringify(localDeleted)) {
            syncAgain = true
            return
        }
        await chrome.storage.local.set(newLocal)
    }

    // 5) update the cloud (only what changed, in one call)
    const toSet = {}
    const toRemove = []
    for (const [id, rec] of Object.entries(best)) {
        const key = SYNC_PREFIX + id
        if (rec.gone) {
            if (mergedDeleted[id] === undefined) {
                if (remote[key]) toRemove.push(key)
                continue
            }
            const tomb = { deleted: true, updatedAt: rec.at }
            if (JSON.stringify(remote[key]) !== JSON.stringify(tomb)) toSet[key] = tomb
        } else if (JSON.stringify(remote[key]) !== JSON.stringify(rec.lead)) {
            toSet[key] = rec.lead
        }
    }

    try {
        if (Object.keys(toSet).length > 0) await chrome.storage.sync.set(toSet)
        if (toRemove.length > 0) await chrome.storage.sync.remove(toRemove)
        await setSyncStatus("ok")
    } catch (error) {
        const text = String((error && error.message) || error)
        if (/WRITE_OPERATIONS/i.test(text)) {
            await setSyncStatus("error", "Syncing too fast. Will retry in a minute.")
        } else if (/quota|MAX_ITEMS/i.test(text)) {
            await setSyncStatus("error", "Sync is full. Delete some old leads to sync again.")
        } else {
            await setSyncStatus("error", "Could not sync. Will try again soon.")
        }
    }
}

// one sync at a time; if something changes meanwhile, run once more
async function runSync() {
    if (syncRunning) {
        syncAgain = true
        return
    }
    syncRunning = true
    try {
        do {
            syncAgain = false
            await syncOnce()
        } while (syncAgain)
    } catch (error) {
        console.error("LeadMemo sync failed:", error)
    } finally {
        syncRunning = false
    }
}

// ---------------------------- events ----------------------------
chrome.runtime.onInstalled.addListener(function () {
    setupAlarm()
    checkLeads()
    runSync()
})

chrome.runtime.onStartup.addListener(function () {
    setupAlarm()
    checkLeads()
    runSync()
})

chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === ALARM_NAME) {
        checkLeads()
        runSync()
    }
})

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && (changes.myLeads || changes.settings)) checkLeads()
    // sync when this device changed, or when another device changed the cloud copy
    if (area === "sync" || (area === "local" && (changes.myLeads || changes.deleted || changes.settings))) runSync()
})