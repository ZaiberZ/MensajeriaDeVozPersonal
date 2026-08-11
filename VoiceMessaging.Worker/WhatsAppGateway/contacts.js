const state = {
    whatsappContacts: [],
    frequentContacts: [],
    selectedContact: null,
    selectedFrequentContact: null
};

const search = document.getElementById("search");
const loadContacts = document.getElementById("loadContacts");
const addFrequent = document.getElementById("addFrequent");
const refreshFrequent = document.getElementById("refreshFrequent");
const frequentName = document.getElementById("frequentName");
const frequentAliases = document.getElementById("frequentAliases");
const addFrequentAlias = document.getElementById("addFrequentAlias");
const saveFrequentName = document.getElementById("saveFrequentName");
const whatsappContacts = document.getElementById("whatsappContacts");
const frequentContacts = document.getElementById("frequentContacts");
const whatsappMessage = document.getElementById("whatsappMessage");
const frequentMessage = document.getElementById("frequentMessage");

function setMessage(element, text) {
    element.textContent = text || "";
}

function normalizeContactLookupName(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
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

function getFilteredWhatsAppContacts() {
    return state.whatsappContacts.filter(contactMatchesSearch);
}

function selectContact(contact, shouldRender = true) {
    state.selectedContact = contact;
    addFrequent.disabled = false;

    if (shouldRender) {
        renderWhatsAppContacts();
        return;
    }

    updateSelectedContactStyles();
}

function updateSelectedContactStyles() {
    for (const item of whatsappContacts.querySelectorAll(".item[data-chat-id]"))
        item.classList.toggle("selected", item.dataset.chatId === state.selectedContact?.chatId);
}

function getFocusedContactItem() {
    const activeElement = document.activeElement;

    if (!activeElement?.classList?.contains("item") || activeElement.parentElement !== whatsappContacts)
        return null;

    return activeElement;
}

function focusContactByIndex(index) {
    const items = [...whatsappContacts.querySelectorAll(".item[data-chat-id]")];

    if (items.length === 0)
        return;

    const nextIndex = Math.min(Math.max(index, 0), items.length - 1);
    items[nextIndex].focus();
}

function focusRelativeContact(offset) {
    const items = [...whatsappContacts.querySelectorAll(".item[data-chat-id]")];

    if (items.length === 0)
        return;

    const focusedItem = getFocusedContactItem();
    const currentIndex = focusedItem ? items.indexOf(focusedItem) : items.findIndex(item => item.dataset.chatId === state.selectedContact?.chatId);
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + offset;

    focusContactByIndex(nextIndex);
}

function renderWhatsAppContacts() {
    const contacts = getFilteredWhatsAppContacts();
    const focusedChatId = getFocusedContactItem()?.dataset.chatId;
    const selectedContactIsVisible = contacts.some(contact => contact.chatId === state.selectedContact?.chatId);

    if (!selectedContactIsVisible) {
        state.selectedContact = null;
        addFrequent.disabled = true;
    }

    whatsappContacts.innerHTML = "";

    if (contacts.length === 0) {
        whatsappContacts.innerHTML = "<div class=\"message\">No hay contactos para mostrar.</div>";
        return;
    }

    for (const contact of contacts) {
        const item = document.createElement("div");
        item.className = "item" + (state.selectedContact?.chatId === contact.chatId ? " selected" : "");
        item.dataset.chatId = contact.chatId;
        item.tabIndex = 0;
        item.innerHTML = `
            <div>
                <div class="name"></div>
                <div class="phone"></div>
            </div>
            <button class="secondary" type="button">Seleccionar</button>
        `;
        item.querySelector(".name").textContent = contact.name;
        item.querySelector(".phone").textContent = contact.phone;
        item.addEventListener("focus", () => selectContact(contact, false));
        item.addEventListener("keydown", event => handleContactItemKeydown(event));
        item.addEventListener("click", () => selectContact(contact));
        item.querySelector("button").addEventListener("click", event => {
            event.stopPropagation();
            selectContact(contact);
        });
        item.querySelector("button").tabIndex = -1;
        whatsappContacts.appendChild(item);
    }

    if (focusedChatId)
        whatsappContacts.querySelector(`[data-chat-id="${CSS.escape(focusedChatId)}"]`)?.focus();
}

function renderFrequentContacts() {
    const selectedId = state.selectedFrequentContact?.id;
    state.selectedFrequentContact = state.frequentContacts.find(contact => contact.id === selectedId) || null;
    frequentContacts.innerHTML = "";
    updateFrequentEditor();

    if (state.frequentContacts.length === 0) {
        frequentContacts.innerHTML = "<div class=\"message\">No hay contactos frecuentes guardados.</div>";
        return;
    }

    for (const contact of state.frequentContacts) {
        const item = document.createElement("div");
        item.className = "item" + (state.selectedFrequentContact?.id === contact.id ? " selected" : "");
        item.dataset.contactId = contact.id;
        item.tabIndex = 0;
        item.innerHTML = `
            <div>
                <div class="name"></div>
                <div class="phone"></div>
                <div class="aliases"></div>
            </div>
            <div class="actions">
                <button class="secondary edit" type="button">Editar</button>
                <button class="danger delete" type="button">Eliminar</button>
            </div>
        `;
        item.querySelector(".name").textContent = contact.name;
        item.querySelector(".phone").textContent = contact.phone;
        item.querySelector(".aliases").textContent = contact.aliases?.length
            ? `También: ${contact.aliases.join(", ")}`
            : "";
        item.addEventListener("click", () => selectFrequentContact(contact));
        item.addEventListener("focus", () => selectFrequentContact(contact, false));
        item.querySelector(".edit").addEventListener("click", event => {
            event.stopPropagation();
            selectFrequentContact(contact);
            frequentName.focus();
            frequentName.select();
        });
        item.querySelector(".delete").addEventListener("click", event => {
            event.stopPropagation();
            deleteFrequent(contact.id);
        });
        frequentContacts.appendChild(item);
    }
}

function selectFrequentContact(contact, shouldRender = true) {
    state.selectedFrequentContact = contact;
    updateFrequentEditor();

    if (shouldRender)
        renderFrequentContacts();
    else {
        for (const item of frequentContacts.querySelectorAll(".item[data-contact-id]"))
            item.classList.toggle("selected", item.dataset.contactId === contact.id);
    }
}

function updateFrequentEditor() {
    const contact = state.selectedFrequentContact;
    frequentName.disabled = !contact;
    saveFrequentName.disabled = !contact;
    frequentName.placeholder = contact
        ? "Nombre del contacto favorito"
        : "Selecciona un favorito para editar su nombre";

    if (document.activeElement !== frequentName)
        frequentName.value = contact?.name || "";

    renderAliasEditor(contact?.aliases || []);
}

function renderAliasEditor(aliases) {
    frequentAliases.innerHTML = "";

    aliases.forEach((alias, index) => {
        const row = document.createElement("div");
        row.className = "alias-row";
        row.innerHTML = `
            <input type="text" maxlength="100" aria-label="Nombre alternativo ${index + 1}">
            <button class="danger" type="button" aria-label="Eliminar nombre alternativo ${index + 1}">Eliminar</button>
        `;
        const input = row.querySelector("input");
        input.value = alias;
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                updateFrequentName();
            }
        });
        row.querySelector("button").addEventListener("click", () => {
            row.remove();
            updateAliasControls();
        });
        frequentAliases.appendChild(row);
    });

    updateAliasControls();
}

function updateAliasControls() {
    const contactSelected = Boolean(state.selectedFrequentContact);
    addFrequentAlias.disabled = !contactSelected || frequentAliases.querySelectorAll("input").length >= 3;
}

async function updateFrequentName() {
    const contact = state.selectedFrequentContact;
    const name = frequentName.value.trim();
    const aliases = [...frequentAliases.querySelectorAll("input")].map(input => input.value.trim()).filter(Boolean);

    if (!contact)
        return;

    if (!name) {
        setMessage(frequentMessage, "El nombre del contacto es obligatorio.");
        frequentName.focus();
        return;
    }

    const ownNames = [name, ...aliases].map(normalizeContactLookupName);

    if (new Set(ownNames).size !== ownNames.length) {
        setMessage(frequentMessage, "El nombre principal y los nombres alternativos no pueden repetirse.");
        return;
    }

    const otherNames = new Set(state.frequentContacts
        .filter(item => item.id !== contact.id)
        .flatMap(item => [item.name, ...(item.aliases || [])])
        .map(normalizeContactLookupName)
        .filter(Boolean));
    const duplicate = [name, ...aliases].find(value => otherNames.has(normalizeContactLookupName(value)));

    if (duplicate) {
        setMessage(frequentMessage, `El nombre "${duplicate}" ya está asignado a otro contacto favorito.`);
        return;
    }

    frequentName.disabled = true;
    for (const aliasInput of frequentAliases.querySelectorAll("input"))
        aliasInput.disabled = true;
    saveFrequentName.disabled = true;
    setMessage(frequentMessage, "Guardando nombres...");

    try {
        await fetch(`/contacts/frequent/${encodeURIComponent(contact.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, aliases })
        }).then(readJson);
        state.selectedFrequentContact = { ...contact, name, aliases };
        await loadFrequentContacts();
        setMessage(frequentMessage, "Nombres actualizados correctamente.");
    } catch (error) {
        setMessage(frequentMessage, error.message);
    } finally {
        updateFrequentEditor();
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

function handleContactItemKeydown(event) {
    if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        saveSelectedContact();
        return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        focusRelativeContact(1);
        return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        focusRelativeContact(-1);
        return;
    }

    if (event.key === "Home") {
        event.preventDefault();
        focusContactByIndex(0);
        return;
    }

    if (event.key === "End") {
        event.preventDefault();
        focusContactByIndex(Number.MAX_SAFE_INTEGER);
    }
}

async function deleteFrequent(id) {
    setMessage(frequentMessage, "Eliminando contacto...");

    try {
        await fetch(`/contacts/frequent/${encodeURIComponent(id)}`, { method: "DELETE" }).then(readJson);
        if (state.selectedFrequentContact?.id === id)
            state.selectedFrequentContact = null;
        await loadFrequentContacts();
    } catch (error) {
        setMessage(frequentMessage, error.message);
    }
}

search.addEventListener("input", renderWhatsAppContacts);
search.addEventListener("keydown", event => {
    if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        saveSelectedContact();
        return;
    }

    if (event.key === "Enter") {
        event.preventDefault();
        loadWhatsAppContacts();
        return;
    }

    if (event.key === "ArrowDown") {
        event.preventDefault();
        focusContactByIndex(0);
    }
});
loadContacts.addEventListener("click", loadWhatsAppContacts);
addFrequent.addEventListener("click", saveSelectedContact);
addFrequent.addEventListener("keydown", event => {
    if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        saveSelectedContact();
    }
});
refreshFrequent.addEventListener("click", loadFrequentContacts);
saveFrequentName.addEventListener("click", updateFrequentName);
addFrequentAlias.addEventListener("click", () => {
    if (!state.selectedFrequentContact || frequentAliases.querySelectorAll("input").length >= 3)
        return;

    const aliases = [...frequentAliases.querySelectorAll("input")].map(input => input.value);
    aliases.push("");
    renderAliasEditor(aliases);
    frequentAliases.lastElementChild?.querySelector("input")?.focus();
});
frequentName.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        updateFrequentName();
    }
});
whatsappContacts.addEventListener("keydown", event => {
    if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        saveSelectedContact();
    }
});

loadFrequentContacts();
