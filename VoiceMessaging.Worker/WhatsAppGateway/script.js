async function saveUser() {

    const body = {

        fullName: document.getElementById("fullName").value,
        phone: document.getElementById("phone").value,
        email: document.getElementById("email").value

    };

    if (!body.fullName || !body.phone || !body.email) {
        alert("Complete todos los datos.");
        return;
    }

    const response = await fetch("/setup-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)

    });

    if (response.ok) {
        alert("Información guardada correctamente.");
    }
    else {
        alert("No fue posible guardar la información.");
    }

}