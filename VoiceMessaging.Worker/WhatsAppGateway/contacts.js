const state = {
    whatsappContacts: [],
    frequentContacts: [],
    selectedContact: null
};

const search = document.getElementById("search");
const loadContacts = document.getElementById("loadContacts");
const addFrequent = document.getElementById("addFrequent");
const refreshFrequent = document.getElementById("refreshFrequent");
const whatsappContacts = document.getElementById("whatsappContacts");
const frequentContacts = document.getElementById("frequentContacts");
const whatsappMessage = document.getElementById("whatsappMessage");
const frequentMessage = document.getElementById("frequentMessage");

function setMessage(element, text) {
    element.textContent = text || "";
}

async function readJson(response) {
    const data = await response.json().catch(() => null);

    if (!response.ok)
        throw new Error(data?.error || data?.message || `HTTP ${response.status}`);

    return data;
}

function contactMatchesSearch(contact) {
    const value = search.value.trim().toLowerCase();

    if (!value)
        return true;

    return `${contact.name} ${contact.phone}`.toLowerCase().includes(value);
}

function renderWhatsAppContacts() {
    const contacts = state.whatsappContacts.filter(contactMatchesSearch);
    whatsappContacts.innerHTML = "";

    if (contacts.length === 0) {
        whatsappContacts.innerHTML = "<div class=\"message\">No hay contactos para mostrar.</div>";
        return;
    }

    for (const contact of contacts) {
        const item = document.createElement("div");
        item.className = "item" + (state.selectedContact?.chatId === contact.chatId ? " selected" : "");
        item.innerHTML = `
            <div>
                <div class="name"></div>
                <div class="phone"></div>
            </div>
            <button class="secondary" type="button">Seleccionar</button>
        `;
        item.querySelector(".name").textContent = contact.name;
        item.querySelector(".phone").textContent = contact.phone;
        item.querySelector("button").addEventListener("click", () => {
            state.selectedContact = contact;
            addFrequent.disabled = false;
            renderWhatsAppContacts();
        });
        whatsappContacts.appendChild(item);
    }
}

function renderFrequentContacts() {
    frequentContacts.innerHTML = "";

    if (state.frequentContacts.length === 0) {
        frequentContacts.innerHTML = "<div class=\"message\">No hay contactos frecuentes guardados.</div>";
        return;
    }

    for (const contact of state.frequentContacts) {
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML = `
            <div>
                <div class="name"></div>
                <div class="phone"></div>
            </div>
            <button class="danger" type="button">Eliminar</button>
        `;
        item.querySelector(".name").textContent = contact.name;
        item.querySelector(".phone").textContent = contact.phone;
        item.querySelector("button").addEventListener("click", () => deleteFrequent(contact.id));
        frequentContacts.appendChild(item);
    }
}

async function loadWhatsAppContacts() {
    setMessage(whatsappMessage, "Cargando contactos...");
    loadContacts.disabled = true;

    try {
        state.whatsappContacts = await fetch("/contacts/whatsapp", { cache: "no-store" }).then(readJson);
        setMessage(whatsappMessage, `${state.whatsappContacts.length} contacto(s) cargado(s).`);
        renderWhatsAppContacts();
    } catch (error) {
        setMessage(whatsappMessage, error.message);
    } finally {
        loadContacts.disabled = false;
    }
}

async function loadFrequentContacts() {
    setMessage(frequentMessage, "Cargando frecuentes...");
    refreshFrequent.disabled = true;

    try {
        state.frequentContacts = await fetch("/contacts/frequent", { cache: "no-store" }).then(readJson);
        setMessage(frequentMessage, "");
        renderFrequentContacts();
    } catch (error) {
        setMessage(frequentMessage, error.message);
    } finally {
        refreshFrequent.disabled = false;
    }
}

async function saveSelectedContact() {
    if (!state.selectedContact)
        return;

    addFrequent.disabled = true;
    setMessage(whatsappMessage, "Guardando contacto...");

    try {
        await fetch("/contacts/frequent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(state.selectedContact)
        }).then(readJson);
        setMessage(whatsappMessage, "Contacto agregado a frecuentes.");
        await loadFrequentContacts();
    } catch (error) {
        setMessage(whatsappMessage, error.message);
    } finally {
        addFrequent.disabled = !state.selectedContact;
    }
}

async function deleteFrequent(id) {
    setMessage(frequentMessage, "Eliminando contacto...");

    try {
        await fetch(`/contacts/frequent/${encodeURIComponent(id)}`, { method: "DELETE" }).then(readJson);
        await loadFrequentContacts();
    } catch (error) {
        setMessage(frequentMessage, error.message);
    }
}

search.addEventListener("input", renderWhatsAppContacts);
loadContacts.addEventListener("click", loadWhatsAppContacts);
addFrequent.addEventListener("click", saveSelectedContact);
refreshFrequent.addEventListener("click", loadFrequentContacts);

loadFrequentContacts();
