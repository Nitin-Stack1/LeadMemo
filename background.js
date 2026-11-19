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

async function checkLeads() {
    const data = await chrome.storage.local.get(["myLeads", "notified"])
    const leads = data.myLeads || []
    const notified = data.notified || {}   // remembers what we already told the user
    const newNotified = {}
    const alerts = []
    let redCount = 0

    for (const lead of leads) {
        const heat = getHeat(lead.lastTouched)
        if (heat === "red") redCount++
        if (heat === "green") continue      // green leads are forgotten, so they can alert again later

        const previous = notified[lead.id] || "green"
        if (RANK[heat] > RANK[previous]) {
            alerts.push({ title: lead.title, heat: heat })
        }
        newNotified[lead.id] = heat
    }

    await chrome.storage.local.set({ notified: newNotified })

    // red-count badge on the extension icon
    await chrome.action.setBadgeText({ text: redCount > 0 ? String(redCount) : "" })
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" })

    // one notification per check
    if (alerts.length === 1) {
        const a = alerts[0]
        chrome.notifications.create("leadmemo-followup", {
            type: "basic",
            iconUrl: "icon.png",
            title: a.heat === "red" ? "Follow up now" : "Lead is getting cold",
            message: a.title
        })
    } else if (alerts.length > 1) {
        chrome.notifications.create("leadmemo-followup", {
            type: "basic",
            iconUrl: "icon.png",
            title: "LeadMemo",
            message: alerts.length + " leads need your follow-up"
        })
    }
}

function setupAlarm() {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 })
}

chrome.runtime.onInstalled.addListener(function () {
    setupAlarm()
    checkLeads()
})

chrome.runtime.onStartup.addListener(function () {
    setupAlarm()
    checkLeads()
})

chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === ALARM_NAME) checkLeads()
})

// run a check whenever leads change (new lead, Contact pressed, setDays test)
chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes.myLeads) checkLeads()
})