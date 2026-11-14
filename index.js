let myLeads = []
const MAX_WORDS = 50

// Heat limits (must be defined before render runs)
const HEAT_YELLOW_DAYS = 3
const HEAT_RED_DAYS = 7
 
const inputEl = document.getElementById("input-el")
const noteEl = document.getElementById("note-el")
const wordCountEl = document.getElementById("word-count")
const tagEl = document.getElementById("tag-el")
const inputBtn = document.getElementById("input-btn")
const tabBtn = document.getElementById("tab-btn")
const deleteBtn = document.getElementById("delete-btn")
const ulEl = document.getElementById("ul-el")
const customTagEl = document.getElementById("custom-tag-el")
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
        contactCount:0
    }
}

function normalizeUrl(url){
    let clean = url.trim().toLowerCase()
    clean = clean.split('#')[0] //remove the #section part
    if(clean.endsWith('/')){
        clean = clean.slice(0,-1) //remove the last slash
    }
    return clean
}

function isDuplicate(url){
    const newUrl = normalizeUrl(url)
    return myLeads.some(function(lead){
        return normalizeUrl(lead.url) === newUrl
    })
}

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
    chrome.tabs.create({url: url})
}

noteEl.addEventListener("input", function() {
    const words = countWords(noteEl.value)
    wordCountEl.textContent = words + " / " + MAX_WORDS + " words"
    inputBtn.disabled = words > MAX_WORDS
    tabBtn.disabled = words > MAX_WORDS
})

function saveLeads() {
    localStorage.setItem("myLeads", JSON.stringify(myLeads))
}

function resetForm() {
    inputEl.value = ""
    noteEl.value = ""
    customTagEl.value = ""
    wordCountEl.textContent = "0 / " + MAX_WORDS + " words"
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
    })
})

//save button clicked then this function invoked
inputBtn.addEventListener("click", function() {
    const value = inputEl.value.trim()
    if (value === "") return

    if(isDuplicate(value)){
        alert("You already saved this link!")
        return
    }
    myLeads.push(makeLead(value, value, noteEl.value.trim(), getTag()))
    saveLeads()
    resetForm()
    render(myLeads)
})

//double clicked delete button the all links are deleted
deleteBtn.addEventListener("dblclick", function() {
    localStorage.removeItem("myLeads")
    myLeads = []
    render(myLeads)
})

function render(leads) {
    ulEl.innerHTML = ""
    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i]
        const li = document.createElement("li")

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
            openLink(lead.url)     //let chrome open it in a new tab
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

        // last touched
        const meta = document.createElement("p")
        meta.className = "meta"
        let metaText = "Last touched: " + touchedText(lead.lastTouched)
        if(lead.contactCount>0){
            metaText+=" | Contacted " + lead.contactCount + (lead.contactCount === 1 ? " time " : " times ")
        }
        meta.textContent = metaText
        li.appendChild(meta)

        // buttons
        const actions = document.createElement("div")
        actions.className = "actions"

        const contactedBtn = document.createElement("button")
        contactedBtn.className = "small-btn"
        contactedBtn.textContent = "Contacted"
        contactedBtn.addEventListener("click", function() {
            lead.lastTouched = Date.now()
            lead.contactCount = (lead.contactCount || 0)+1
            saveLeads()
            render(myLeads)
        })
        actions.appendChild(contactedBtn)

        const delLeadBtn = document.createElement("button")
        delLeadBtn.className = "small-btn del-lead"
        delLeadBtn.textContent = "Delete"
        delLeadBtn.addEventListener("click", function() {
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

// Load saved leads. This must stay at the END of the file,
// so everything above (constants, functions) is ready before render runs.
const saved = JSON.parse(localStorage.getItem("myLeads"))
if (saved) {
    myLeads = saved.map(function(item, index) {
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
            contactCount:item.contactCount || 0
        }
    })
    saveLeads()
    render(myLeads)
}

function getTopThree(){
    return myLeads
    .filter(function(lead){
        return getHeat(lead.lastTouched)!== 'green'
    })
    .sort(function(a,b){
        return a.lastTouched - b.lastTouched
    })
    .slice(0,3)
}

function renderTopThree(){
    topThreeEl.innerHTML = ""
    if(myLeads.length == 0) return 
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


    for(let i=0;i<topLeads.length;i++){
        const lead = topLeads[i]
        const item = document.createElement('div')
        item.className = 'top-item'

        const dot = document.createElement('span')
        dot.className = 'dot'+getHeat(lead.lastTouched)
        item.appendChild(dot)

        const a = document.createElement("a")
        a.href = lead.url
        a.textContent = lead.title


        a.addEventListener("click",function(event){
            event.preventDefault()
            openLink(lead.url)

        })

        item.appendChild(a)

        const when = document.createElement("span")
        when.className = "meta"
        when.textContent = " - "+touchedText(lead.lastTouched)
        item.appendChild(when)

        topThreeEl.appendChild(item)

    }


}
