import { CONFIG } from "../config.js";
import { cryptoService } from "../api/cryptoService.js";
import { socketManager } from "../api/socketManager.js";

/**
 * Inyecta el botón de RoleSync en la cabecera de la ficha de personaje 
 * y gestiona el flujo de apertura del diálogo del código QR.
 */
export function setupQrDialog(app, controls) {
    if (!app.document || app.document.documentName !== "Actor") return;

    controls.unshift({
        icon: "fa-solid fa-qrcode",
        label: "Role-Sync QR",
        tooltip: "Generar Código QR",
        action: "generateQr"
    });

    if (!app.options.actions["generateQr"]) {
        app.options.actions["generateQr"] = async function(event, target) {
            const actor = app.document;
            if (!actor) return;

            const worldId = game.settings.get(CONFIG.MODULE_ID, CONFIG.SETTING_WORLD_ID);
            if (!worldId) {
                ui.notifications.error("RoleSync | No se ha encontrado el World ID de la partida.");
                return;
            }

            const characterId = actor.id;
            let token = localStorage.getItem(CONFIG.TOKEN_KEY);

            // 1. Comprobamos si el token existente es válido y pertenece a este personaje
            if (token) {
                const validation = await cryptoService.validateToken(token, worldId);
                if (!validation.isValid || validation.characterId !== characterId) {
                    token = null; 
                }
            }

            // 2. Si no hay token válido para este personaje, creamos uno nuevo
            if (!token) {
                token = await cryptoService.createToken(worldId, characterId);
                localStorage.setItem(CONFIG.TOKEN_KEY, token);
                console.log(`RoleSync | Creado nuevo token para el personaje: ${characterId}`);
            }

            // 👇 NUEVA COMPROBACIÓN INTELIGENTE 👇
            // Si el socket ya está conectado y es el mismo personaje, nos saltamos la reconexión innecesaria
            const socket = socketManager.getSocket();
            const activeCharacterId = socketManager.getActiveCharacterId();
            
            let connected = socket && socket.connected && activeCharacterId === characterId;

            if (!connected) {
                // 3. Conectamos el socket a Render solo si no estaba ya conectado
                connected = await socketManager.connectWithToken(worldId, characterId, token);
                if (!connected) {
                    ui.notifications.error("RoleSync | No se pudo conectar con el servidor de Role-Sync.");
                    return;
                }
            } else {
                console.log("RoleSync | Socket ya activo para este personaje, reutilizando conexión...");
            }

            // 4. Solicitamos el OTP a Render
            const currentSocket = socketManager.getSocket();
            currentSocket.emit('GENERATE_OTP', {
                worldId,
                characterId,
                playerId: game.user.id,
                token
            }, async (res) => { // <-- ¡IMPORTANTE! Añadimos 'async' aquí al callback
                if (!res || !res.success) {
                    ui.notifications.error(`RoleSync | Error al solicitar OTP: ${res?.error || 'Sin respuesta'}`);
                    return;
                }

                const otp = res.otp;
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(otp)}`;

                // 👇 MAGIA DE FOUNDRY AQUÍ 👇
                // Compilamos la plantilla pasándole nuestras variables
                const templatePath = `modules/${CONFIG.MODULE_ID}/templates/qr-dialog.hbs`;
                const contentHTML = await renderTemplate(templatePath, {
                    actorName: actor.name,
                    qrUrl: qrUrl,
                    otp: otp
                });

                // Renderizamos el diálogo (esto queda igual)
                if (foundry.applications?.api?.DialogV2) {
                    foundry.applications.api.DialogV2.prompt({
                        window: { title: `Vincular Personaje: ${actor.name}` },
                        content: contentHTML,
                        ok: { label: "Cerrar", callback: () => {} }
                    });
                } else {
                    new Dialog({
                        title: `Vincular Personaje: ${actor.name}`,
                        content: contentHTML,
                        buttons: {
                            close: { label: "Cerrar" }
                        }
                    }).render(true);
                }
            });
        };
    }
}