let myLeads = []
let deletedLog = {}   // id -> time deleted, used by cloud sync
const MAX_WORDS = 50

// Heat limits (must be defined before render runs)
const HEAT_YELLOW_DAYS = 3
const HEAT_RED_DAYS = 7

// Tags that need contact tracking. Every other tag is just a link to remember.
const CONTACT_TAGS = ["Client", "Job"]

const inputEl = document.getElementById("input-el")
const noteEl = document.getElementById("note-el")
const wordCountEl = document.getElementById("word-count")
const tagEl = document.getElementById("tag-el")
const customTagEl = document.getElementById("custom-tag-el")
const inputBtn = document.getElementById("input-btn")
const tabBtn = document.getElementById("tab-btn")
const deleteBtn = document.getElementById("delete-btn")
const ulEl = document.getElementById("ul-el")
const topThreeEl = document.getElementById("top-three")

//make lead function
function makeLead(url, title, note, tag) {
    const now = Date.now()
    return {
        id: now,
        url: url,
        title: title,
        note: note,
        tag: tag,
        createdAt: now,
        lastTouched: now,
        contactCount: 0,
        updatedAt: now
    }
}

// does this lead need contact tracking?
function isContactLead(lead) {
    return CONTACT_TAGS.includes(lead.tag)
}

function normalizeUrl(url){
    let clean = url.trim().toLowerCase()
    clean = clean.replace(/^https?:\/\/(www\.)?/, "") //remove https://, http:// and www.
    clean = clean.split('#')[0]                         //remove the #section part
    if(clean.endsWith('/')){
        clean = clean.slice(0,-1)                       //remove the last slash
    }
    return clean
}

// make a full link from what the user typed, or return null if it is not a link
function toValidUrl(text) {
    let value = text.trim()
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        value = "https://" + value
    }
    try {
        const url = new URL(value)
        if (!url.hostname.includes(".")) return null
        return url.href
    } catch (error) {
        return null
    }
}

// readable name for a link, e.g. linkedin.com/in/rahul-sharma
function displayTitle(url) {
    return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")
}

function isDuplicate(url){
    const newUrl = normalizeUrl(url)
    return myLeads.some(function(lead){
        return normalizeUrl(lead.url) === newUrl
    })
}

// show the custom tag box only when "Other" is selected
tagEl.addEventListener("change",function(){
    if(tagEl.value === 'Other'){
        customTagEl.classList.remove('hidden')
        customTagEl.focus()
    }else{
        customTagEl.classList.add('hidden')
        customTagEl.value = ""
    }
})

//decide which tag to save
function getTag(){
    if(tagEl.value === 'Other'){
        const custom = customTagEl.value.trim()
        return custom === ""? 'Other' : custom
    }
    return tagEl.value
}

function countWords(text) {
    const trimmed = text.trim()
    if (trimmed === "") return 0
    return trimmed.split(/\s+/).length
}

function daysSince(timestamp) {
    const oneDay = 1000 * 60 * 60 * 24
    return Math.floor((Date.now() - timestamp) / oneDay)
}

function touchedText(timestamp) {
    const minutes = Math.floor((Date.now() - timestamp) / (1000 * 60))
    if (minutes < 1) return "just now"
    if (minutes < 60) return minutes + " min ago"

    const hours = Math.floor(minutes / 60)
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago")

    const days = daysSince(timestamp)
    if (days === 1) return "1 day ago"
    return days + " days ago"
}

function getHeat(timestamp){
    const days = daysSince(timestamp)
    if (days >= HEAT_RED_DAYS) return "red"
    if (days >= HEAT_YELLOW_DAYS) return "yellow"
    return "green"
}

function openLink(url){
    if (!/^(https?|chrome|file):\/\//i.test(url)) return
    chrome.tabs.create({url: url})
}

// text under each lead (different for contact leads and plain links)
function statusText(lead) {
    if (!isContactLead(lead)) {
        return "Last opened: " + touchedText(lead.lastTouched)
    }
    const count = lead.contactCount || 0
    if (count > 0) {
        return "Last contacted: " + touchedText(lead.lastTouched) +
            " | Contacted " + count + (count === 1 ? " time" : " times")
    }
    return "Saved " + touchedText(lead.lastTouched) + ", not contacted yet"
}

// mark a contact lead as contacted: timer restarts, count goes up, link opens
function contactLead(lead) {
    lead.lastTouched = Date.now()
    lead.updatedAt = lead.lastTouched
    lead.contactCount = (lead.contactCount || 0) + 1
    saveLeads()
    render(myLeads)
    openLink(lead.url)
}

// clicking a plain link counts as opening it, so it stops getting cold
function openLead(lead) {
    if (!isContactLead(lead)) {
        lead.lastTouched = Date.now()
        lead.updatedAt = lead.lastTouched
        saveLeads()
        render(myLeads)
    }
    openLink(lead.url)
}

noteEl.addEventListener("input", function() {
    const words = countWords(noteEl.value)
    wordCountEl.textContent = words + " / " + MAX_WORDS + " words"
    inputBtn.disabled = words > MAX_WORDS
    tabBtn.disabled = words > MAX_WORDS
    // counter colour: normal, amber when close, red when over the limit
    wordCountEl.classList.toggle("near", words >= MAX_WORDS - 10 && words <= MAX_WORDS)
    wordCountEl.classList.toggle("over", words > MAX_WORDS)
})

// leads are kept in chrome.storage.local so the popup AND the background
// service worker (notifications, later) can both read them
function saveLeads() {
    chrome.storage.local.set({ myLeads: myLeads, deleted: deletedLog })
}

function resetForm() {
    inputEl.value = ""
    noteEl.value = ""
    customTagEl.value = ""
    wordCountEl.textContent = "0 / " + MAX_WORDS + " words"
    wordCountEl.classList.remove("near", "over")
}

tabBtn.addEventListener("click", function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const url = tabs[0].url

        if(isDuplicate(url)){
            alert("You already saved this link!")
            return
        }
        myLeads.push(makeLead(tabs[0].url, tabs[0].title, noteEl.value.trim(), getTag()))
        saveLeads()
        resetForm()
        render(myLeads)
        showTopThree()
    })
})

//save button clicked then this function invoked
inputBtn.addEventListener("click", function() {
    if (inputEl.value.trim() === "") return

    const url = toValidUrl(inputEl.value)
    if (url === null) {
        alert("Please paste a valid link (like linkedin.com/in/name), not a name.")
        return
    }

    if(isDuplicate(url)){
        alert("You already saved this link!")
        return
    }
    myLeads.push(makeLead(url, displayTitle(url), noteEl.value.trim(), getTag()))
    saveLeads()
    resetForm()
    render(myLeads)
    showTopThree()
})

//double clicked delete button the all links are deleted
deleteBtn.addEventListener("dblclick", function() {
    const when = Date.now()
    myLeads.forEach(function(lead){ deletedLog[lead.id] = when })
    myLeads = []
    saveLeads()
    render(myLeads)
})
function showTopThree(){
    topThreeEl.classList.remove("hidden")
}
function getTopThree(){
    return myLeads
    .filter(function(lead){
        return getHeat(lead.lastTouched) !== 'green'
    })
    .sort(function(a,b){
        return a.lastTouched - b.lastTouched
    })
    .slice(0,3)
}

function renderTopThree(){
    topThreeEl.innerHTML = ""
    if(myLeads.length === 0) return

    const heading = document.createElement("h3")
    heading.textContent = "Today's Top 3"
    topThreeEl.appendChild(heading)

    const topLeads = getTopThree()

    if(topLeads.length === 0){
        const msg = document.createElement('p')
        msg.className = 'meta'
        msg.textContent = "All your leads are warm"
        topThreeEl.appendChild(msg)
        return
    }

    for(let i = 0; i < topLeads.length; i++){
        const lead = topLeads[i]
        const item = document.createElement('div')
        item.className = 'top-item'

        const dot = document.createElement('span')
        dot.className = 'dot ' + getHeat(lead.lastTouched)
        item.appendChild(dot)

        const a = document.createElement("a")
        a.href = lead.url
        a.textContent = lead.title
        a.addEventListener("click", function(event){
            event.preventDefault()   // the row click below opens the link
        })
        item.appendChild(a)

        // Contact button (Client / Job): contact the lead and it leaves Top 3
        if (isContactLead(lead)) {
            const contactBtn = document.createElement("button")
            contactBtn.className = "small-btn"
            contactBtn.textContent = "Contact"
            contactBtn.addEventListener("click", function(event){
                event.stopPropagation()   // do not also run the row click
                contactLead(lead)
            })
            item.appendChild(contactBtn)
        }

        // click anywhere on the row to open the saved link
        item.title = "Open " + lead.url
        item.addEventListener("click", function(){
            openLead(lead)
        })

        const when = document.createElement("span")
        when.className = "meta"
        when.textContent = statusText(lead)
        item.appendChild(when)

        topThreeEl.appendChild(item)
    }
}

function render(leads) {
    ulEl.innerHTML = ""
    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i]
        const li = document.createElement("li")

        // age strip: 8 cells for day 0..7. Cells fill as the lead gets older,
        // so you can see how far it is from turning red.
        const days = daysSince(lead.lastTouched)
        const age = document.createElement("div")
        age.className = "age"
        age.title = days + (days === 1 ? " day" : " days") + " since last touch"
        for (let k = 0; k < 8; k++) {
            const cell = document.createElement("span")
            const colour = k < HEAT_YELLOW_DAYS ? "g" : (k < HEAT_RED_DAYS ? "y" : "r")
            cell.className = "cell " + colour + (k <= days ? " on" : "")
            age.appendChild(cell)
        }
        li.appendChild(age)

        // top row: dot + title on the left, tag on the right
        const top = document.createElement("div")
        top.className = "lead-top"

        const left = document.createElement("div")

        const dot = document.createElement("span")
        dot.className = "dot " + getHeat(lead.lastTouched)
        left.appendChild(dot)

        const a = document.createElement("a")
        a.href = lead.url
        a.textContent = lead.title
        a.addEventListener("click", function(event){
            event.preventDefault() //stop the normal link behaviour
            openLead(lead)
        })
        left.appendChild(a)
        top.appendChild(left)

        const tagSpan = document.createElement("span")
        tagSpan.className = "tag"
        tagSpan.textContent = lead.tag
        top.appendChild(tagSpan)
        li.appendChild(top)

        // note
        if (lead.note) {
            const p = document.createElement("p")
            p.className = "note"
            p.textContent = lead.note
            li.appendChild(p)
        }

        // status line
        const meta = document.createElement("p")
        meta.className = "meta"
        meta.textContent = statusText(lead)
        li.appendChild(meta)

        // buttons
        const actions = document.createElement("div")
        actions.className = "actions"

        // Contact button only for contact leads (Client / Job)
        if (isContactLead(lead)) {
            const contactBtn = document.createElement("button")
            contactBtn.className = "small-btn"
            contactBtn.textContent = "Contact"
            contactBtn.addEventListener("click", function() {
                contactLead(lead)
            })
            actions.appendChild(contactBtn)
        }

        const delLeadBtn = document.createElement("button")
        delLeadBtn.className = "small-btn del-lead"
        delLeadBtn.textContent = "Delete"
        delLeadBtn.addEventListener("click", function() {
            deletedLog[lead.id] = Date.now()
            myLeads = myLeads.filter(function(l) {
                return l.id !== lead.id
            })
            saveLeads()
            render(myLeads)
        })
        actions.appendChild(delLeadBtn)

        li.appendChild(actions)
        ulEl.appendChild(li)
    }
    renderTopThree()
}

// Clean up one saved lead (also upgrades very old string-only leads)
function normalizeLead(item, index) {
    if (typeof item === "string") {
        item = { url: item, title: item, note: "" }
    }
    const now = Date.now()
    return {
        id: item.id || now + index,
        url: item.url,
        title: item.title || item.url,
        note: item.note || "",
        tag: item.tag || "Other",
        createdAt: item.createdAt || now,
        lastTouched: item.lastTouched || now,
        contactCount: item.contactCount || 0,
        updatedAt: item.updatedAt || item.lastTouched || item.createdAt || now
    }
}

// Load saved leads. This must stay at the END of the file,
// so everything above (constants, functions) is ready before render runs.
async function loadLeads() {
    const result = await chrome.storage.local.get(["myLeads", "deleted"])
    let saved = result.myLeads
    deletedLog = result.deleted || {}

    // One-time migration: copy old localStorage leads into chrome.storage.local
    if (!saved) {
        try {
            const old = JSON.parse(localStorage.getItem("myLeads"))
            if (old && old.length > 0) {
                saved = old
                await chrome.storage.local.set({ myLeads: old.map(normalizeLead) })
                localStorage.removeItem("myLeads") // only after the copy succeeded
            }
        } catch (error) {
            console.error("LeadMemo migration failed:", error)
        }
    }

    if (saved) {
        myLeads = saved.map(normalizeLead)
        saveLeads()
        render(myLeads)
        if (myLeads.length > 0) showTopThree()
    }
}
loadLeads()

// ---- Settings (notifications on/off, daily reminder on/off) ----
const notifToggle = document.getElementById("notif-toggle")
const dailyToggle = document.getElementById("daily-toggle")
const syncToggle = document.getElementById("sync-toggle")
const syncStatusEl = document.getElementById("sync-status")

function saveSettings() {
    chrome.storage.local.set({
        settings: {
            notifications: notifToggle.checked,
            dailyReminder: dailyToggle.checked,
            sync: syncToggle.checked
        }
    })
    dailyToggle.disabled = !notifToggle.checked
}

async function loadSettings() {
    const result = await chrome.storage.local.get("settings")
    const settings = Object.assign({ notifications: true, dailyReminder: true, sync: true }, result.settings)
    notifToggle.checked = settings.notifications
    dailyToggle.checked = settings.dailyReminder
    syncToggle.checked = settings.sync
    dailyToggle.disabled = !settings.notifications
}

notifToggle.addEventListener("change", saveSettings)
dailyToggle.addEventListener("change", saveSettings)
syncToggle.addEventListener("change", saveSettings)
loadSettings()

// ---- Cloud sync status line + live updates from other devices ----
function renderSyncStatus(status) {
    syncStatusEl.className = "sync-status"
    if (!status) {
        syncStatusEl.textContent = "Sync: waiting for first sync"
    } else if (status.state === "ok") {
        syncStatusEl.textContent = "Synced " + touchedText(status.at)
    } else if (status.state === "off") {
        syncStatusEl.textContent = "Sync is off. Leads stay on this device."
    } else {
        syncStatusEl.textContent = status.message || "Could not sync."
        syncStatusEl.classList.add("bad")
    }
}

chrome.storage.local.get("syncStatus").then(function(result) {
    renderSyncStatus(result.syncStatus)
})

chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== "local") return
    if (changes.deleted) deletedLog = changes.deleted.newValue || {}
    if (changes.syncStatus) renderSyncStatus(changes.syncStatus.newValue)
    // another device changed a lead: show it without reopening the popup
    if (changes.myLeads) {
        const incoming = (changes.myLeads.newValue || []).map(normalizeLead)
        if (JSON.stringify(incoming) !== JSON.stringify(myLeads)) {
            myLeads = incoming
            render(myLeads)
            if (myLeads.length > 0) showTopThree()
        }
    }
})

//manually set the days 
function setDays(i,d){
    myLeads[i].lastTouched = Date.now()-d*24*60*60*1000
    myLeads[i].updatedAt = Date.now()
    saveLeads()
    render(myLeads)
}