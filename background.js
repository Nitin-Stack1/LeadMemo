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

const DEFAULT_SETTINGS = { notifications: true, dailyReminder: true }

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

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && (changes.myLeads || changes.settings)) checkLeads()
})