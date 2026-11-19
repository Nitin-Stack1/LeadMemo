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

const BASE_TAGS = ["Client", "Job", "Research", "Other"]

function allTags() {
    return Array.from(new Set(myLeads.map(function (lead) { return lead.tag })))
}

//decide which tag to save (reuses an existing tag if only the letter case differs)
function getTag(){
    if(tagEl.value === 'Other'){
        const custom = customTagEl.value.trim()
        if(custom === "") return 'Other'
        const same = BASE_TAGS.concat(allTags()).find(function (t) {
            return t.toLowerCase() === custom.toLowerCase()
        })
        return same || custom
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
    showSuggestions([])
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

const searchEl = document.getElementById("search-el")
const filterEl = document.getElementById("filter-el")
const suggestEl = document.getElementById("tag-suggest")

const TAG_WORDS = {
    Client: ["client", "customer", "proposal", "quote", "quotation", "invoice", "payment", "project", "deal", "order", "contract", "demo", "pricing", "budget", "requirement", "buyer", "meeting", "enquiry", "inquiry"],
    Job: ["job", "hiring", "hire", "interview", "recruiter", "resume", "cv", "salary", "vacancy", "opening", "position", "role", "apply", "application", "offer", "referral", "ctc"]
}
const STOP_WORDS = new Set("the and for with this that from have has about into your you are was were will not but can our their they them then than also just need want call send get got how what when where who why very more some any all new old now today tomorrow said sent after before great good best really talk told asked saying list lists watch like make made will would could should please thanks thank very much many".split(" "))

function words(text) {
    return String(text).toLowerCase().match(/[a-z0-9]+/g) || []
}

function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1)
}

function ruleSuggestions(note) {
    const list = words(note)
    const lower = note.toLowerCase()
    const base = []
    Object.keys(TAG_WORDS).forEach(function (tag) {
        const hits = list.filter(function (w) { return TAG_WORDS[tag].includes(w) }).length
        if (hits > 0) base.push({ tag: tag, hits: hits })
    })
    base.sort(function (a, b) { return b.hits - a.hits })

    const used = allTags().filter(function (tag) {
        return !BASE_TAGS.includes(tag) && lower.includes(tag.toLowerCase())
    })
    const extra = []
    list.forEach(function (w) {
        if (w.length < 4 || STOP_WORDS.has(w) || /^\d+$/.test(w)) return
        if (!extra.includes(capitalize(w))) extra.push(capitalize(w))
    })
    extra.sort(function (a, b) { return b.length - a.length })
    return { base: base.map(function (b) { return b.tag }), used: used, extra: extra.slice(0, 2) }
}

function mergeSuggestions(parts) {
    const out = []
    parts.forEach(function (tag) {
        if (!out.some(function (t) { return t.toLowerCase() === tag.toLowerCase() })) out.push(tag)
    })
    return out.slice(0, 6)
}

async function aiTags(note) {
    if (typeof LanguageModel === "undefined") return []
    const lang = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] }
    if ((await LanguageModel.availability(lang)) !== "available") return []
    const session = await LanguageModel.create(Object.assign({}, lang, {
        initialPrompts: [{ role: "system", content: "Suggest up to 3 short tags (1-2 words each) for a saved link based on the user's note. Reply with only the tags, separated by commas." }]
    }))
    try {
        const out = await session.prompt(note)
        return String(out).split(",").map(function (t) {
            return t.trim().replace(/[^\w &-]/g, "")
        }).filter(function (t) { return t && t.length <= 20 }).slice(0, 3)
    } finally {
        session.destroy()
    }
}

function pickTag(tag) {
    if (BASE_TAGS.includes(tag)) {
        tagEl.value = tag
        tagEl.dispatchEvent(new Event("change"))
    } else {
        tagEl.value = "Other"
        tagEl.dispatchEvent(new Event("change"))
        customTagEl.value = tag.slice(0, 20)
    }
}

function showSuggestions(tags) {
    suggestEl.innerHTML = ""
    suggestEl.classList.toggle("hidden", tags.length === 0)
    if (tags.length === 0) return
    const label = document.createElement("span")
    label.className = "suggest-label"
    label.textContent = "Suggested tags:"
    suggestEl.appendChild(label)
    tags.forEach(function (tag) {
        const chip = document.createElement("button")
        chip.type = "button"
        chip.className = "chip"
        chip.textContent = tag
        chip.addEventListener("click", function () { pickTag(tag) })
        suggestEl.appendChild(chip)
    })
}

let suggestTimer = null
let suggestRun = 0
noteEl.addEventListener("input", function () {
    clearTimeout(suggestTimer)
    const note = noteEl.value.trim()
    if (countWords(note) < 2) {
        suggestRun++
        showSuggestions([])
        return
    }
    suggestTimer = setTimeout(async function () {
        const run = ++suggestRun
        const rules = ruleSuggestions(note)
        showSuggestions(mergeSuggestions(rules.base.concat(rules.used, rules.extra)))
        try {
            const ai = await aiTags(note)
            if (run !== suggestRun || ai.length === 0) return
            showSuggestions(mergeSuggestions(rules.base.concat(ai, rules.used, rules.extra)))
        } catch (error) {
            console.error("LeadMemo tag AI failed:", error)
        }
    }, 400)
})

function fillFilter() {
    const current = filterEl.value
    filterEl.innerHTML = ""
    filterEl.appendChild(new Option("All tags", ""))
    filterEl.appendChild(new Option("Red leads (7+ days)", "__red"))
    allTags().sort().forEach(function (tag) { filterEl.appendChild(new Option(tag, tag)) })
    const exists = Array.from(filterEl.options).some(function (o) { return o.value === current })
    filterEl.value = exists ? current : ""
}

function visibleLeads(leads) {
    const query = words(searchEl.value)
    const filter = filterEl.value
    return leads.filter(function (lead) {
        if (filter === "__red" && getHeat(lead.lastTouched) !== "red") return false
        if (filter && filter !== "__red" && lead.tag !== filter) return false
        const text = (lead.title + " " + lead.url + " " + lead.note + " " + lead.tag).toLowerCase()
        return query.every(function (w) { return text.includes(w) })
    })
}

searchEl.addEventListener("input", function () { render(myLeads) })
filterEl.addEventListener("change", function () { render(myLeads) })

function matchTag(custom) {
    const text = custom.trim()
    if (text === "") return "Other"
    const same = BASE_TAGS.concat(allTags()).find(function (t) {
        return t.toLowerCase() === text.toLowerCase()
    })
    return same || text
}

function toggleEditPanel(lead, li) {
    const old = li.querySelector(".edit-panel")
    if (old) { old.remove(); return }

    const panel = document.createElement("div")
    panel.className = "edit-panel"

    const titleBox = document.createElement("input")
    titleBox.type = "text"
    titleBox.maxLength = 100
    titleBox.value = lead.title
    titleBox.placeholder = "Name"
    panel.appendChild(titleBox)

    const noteBox = document.createElement("textarea")
    noteBox.rows = 3
    noteBox.value = lead.note || ""
    noteBox.placeholder = "Note (max " + MAX_WORDS + " words)"
    panel.appendChild(noteBox)

    const count = document.createElement("p")
    count.className = "meta"
    panel.appendChild(count)

    const tagBox = document.createElement("select")
    BASE_TAGS.forEach(function (t) { tagBox.appendChild(new Option(t, t)) })
    const isBase = BASE_TAGS.includes(lead.tag)
    tagBox.value = isBase ? lead.tag : "Other"
    panel.appendChild(tagBox)

    const customBox = document.createElement("input")
    customBox.type = "text"
    customBox.maxLength = 20
    customBox.placeholder = "Your own tag"
    customBox.value = isBase ? "" : lead.tag
    customBox.classList.toggle("hidden", tagBox.value !== "Other")
    panel.appendChild(customBox)
    tagBox.addEventListener("change", function () {
        customBox.classList.toggle("hidden", tagBox.value !== "Other")
    })

    const row = document.createElement("div")
    row.className = "actions"
    const saveBtn = document.createElement("button")
    saveBtn.className = "small-btn"
    saveBtn.textContent = "Save"
    const cancelBtn = document.createElement("button")
    cancelBtn.className = "small-btn del-lead"
    cancelBtn.textContent = "Cancel"
    row.appendChild(saveBtn)
    row.appendChild(cancelBtn)
    panel.appendChild(row)

    function updateCount() {
        const words = countWords(noteBox.value)
        count.textContent = words + " / " + MAX_WORDS + " words"
        saveBtn.disabled = words > MAX_WORDS
    }
    noteBox.addEventListener("input", updateCount)
    updateCount()

    saveBtn.addEventListener("click", function () {
        const title = titleBox.value.trim()
        if (title === "") {
            alert("Name cannot be empty.")
            return
        }
        lead.title = title
        lead.note = noteBox.value.trim()
        lead.tag = tagBox.value === "Other" ? matchTag(customBox.value) : tagBox.value
        lead.updatedAt = Date.now()
        saveLeads()
        render(myLeads)
        showTopThree()
    })
    cancelBtn.addEventListener("click", function () { panel.remove() })

    li.appendChild(panel)
}

function render(leads) {
    fillFilter()
    const total = leads.length
    leads = visibleLeads(leads)
    ulEl.innerHTML = ""
    if (total > 0 && leads.length === 0) {
        const none = document.createElement("li")
        none.className = "meta"
        none.textContent = "No leads match your search."
        ulEl.appendChild(none)
    }
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

        const editBtn = document.createElement("button")
        editBtn.className = "small-btn edit-btn"
        editBtn.textContent = "Edit"
        editBtn.addEventListener("click", function() {
            toggleEditPanel(lead, li)
        })
        actions.appendChild(editBtn)

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