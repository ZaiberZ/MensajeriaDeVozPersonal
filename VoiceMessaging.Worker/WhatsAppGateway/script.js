const page = document.querySelector("[data-page]")?.dataset.page;

if (page === "qr") {
    loadQr();
    setInterval(loadQr, 3000);
}

if (page === "userdata") {
    document.getElementById("userForm").addEventListener("submit", saveUser);
    document.getElementById("editUserButton").addEventListener("click", editUser);
    document.getElementById("clearUserButton").addEventListener("click", clearUser);
    loadUserData();
}

async function loadQr() {
    const message = document.getElementById("qrMessage");
    const image = document.getElementById("qrImage");

    try {
        const response = await fetch("/whatsapp/qr-data", { cache: "no-store" });

        if (!response.ok) {
            const statusResponse = await fetch("/whatsapp/status", { cache: "no-store" });
            const status = await statusResponse.json();

            image.hidden = true;
            message.textContent = status.connected
                ? "WhatsApp ya está conectado; no es necesario escanear un código."
                : "Todavía no hay un código QR disponible. Esta página se actualizará automáticamente.";
            return;
        }

        const data = await response.json();
        image.src = data.qr;
        image.hidden = false;
        message.textContent = "Escanea este código con WhatsApp.";
    } catch (error) {
        image.hidden = true;
        message.textContent = "No fue posible consultar el código QR.";
        console.error(error);
    }
}

async function loadUserData() {
    const message = document.getElementById("userMessage");
    const registeredUser = document.getElementById("registeredUser");
    const form = document.getElementById("userForm");

    try {
        const response = await fetch("/whatsapp/status", { cache: "no-store" });

        if (!response.ok)
            throw new Error("No fue posible consultar el estado del gateway.");

        const status = await response.json();
        const user = status.User ?? status.user;

        if (user?.Phone) {
            document.getElementById("savedFullName").textContent = user.FullName || "Sin especificar";
            document.getElementById("savedPhone").textContent = user.Phone;
            document.getElementById("savedEmail").textContent = user.Email || "Sin especificar";
            document.getElementById("savedSupportPhone").textContent = user.SupportPhone || "Sin especificar";
            document.getElementById("savedSecondAribnbPhone").textContent = user.SecondAribnbPhone || "Sin especificar";
            setUserFormValues(user);

            message.textContent = "Usuario registrado.";
            registeredUser.hidden = false;
            form.hidden = true;
            return;
        }

        message.textContent = "No hay un usuario registrado. Completa el formulario:";
        registeredUser.hidden = true;
        form.hidden = false;
        form.reset();
    } catch (error) {
        message.textContent = error.message;
        message.classList.add("error");
        registeredUser.hidden = true;
        form.hidden = true;
        console.error(error);
    }
}

function setUserFormValues(user) {
    document.getElementById("fullName").value = user.FullName || "";
    document.getElementById("phone").value = user.Phone || "";
    document.getElementById("email").value = user.Email || "";
    document.getElementById("supportPhone").value = user.SupportPhone || "";
    document.getElementById("secondAribnbPhone").value = user.SecondAribnbPhone || "";
}

function editUser() {
    document.getElementById("registeredUser").hidden = true;
    document.getElementById("userForm").hidden = false;
    document.getElementById("userMessage").textContent = "Modifica los datos actuales:";
}

async function saveUser(event) {
    event.preventDefault();

    const button = document.getElementById("saveUserButton");
    const message = document.getElementById("userMessage");
    const body = {
        fullName: document.getElementById("fullName").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        email: document.getElementById("email").value.trim(),
        supportPhone: document.getElementById("supportPhone").value.trim(),
        secondAribnbPhone: document.getElementById("secondAribnbPhone").value.trim()
    };

    if (!body.fullName || !body.phone || !body.email) {
        message.textContent = "Completa todos los datos.";
        message.classList.add("error");
        return;
    }

    button.disabled = true;
    message.classList.remove("error");
    message.textContent = "Guardando información...";

    try {
        const response = await fetch("/whatsapp/setup-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.message || "No fue posible guardar la información.");
        }

        await loadUserData();
    } catch (error) {
        message.textContent = error.message;
        message.classList.add("error");
        console.error(error);
    } finally {
        button.disabled = false;
    }
}

async function clearUser() {
    if (!window.confirm("¿Está seguro de que desea eliminar la información actual?"))
        return;

    const button = document.getElementById("clearUserButton");
    const message = document.getElementById("userMessage");

    button.disabled = true;
    message.classList.remove("error");
    message.textContent = "Eliminando información...";

    try {
        const response = await fetch("/whatsapp/setup-user", { method: "DELETE" });

        if (!response.ok) {
            const result = await response.json();
            throw new Error(result.message || "No fue posible eliminar la información.");
        }

        document.getElementById("userForm").reset();
        await loadUserData();
    } catch (error) {
        message.textContent = error.message;
        message.classList.add("error");
        console.error(error);
    } finally {
        button.disabled = false;
    }
}
