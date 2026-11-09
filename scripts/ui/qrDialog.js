import { CONFIG } from "../config.js";
import { cryptoService } from "../api/cryptoService.js";
import { socketManager } from "../api/socketManager.js";

/**
 * Inyecta el botón de "Role-Sync QR" en la cabecera de las fichas de personaje (Actor) de Foundry VTT.
 * Gestiona el flujo completo de vinculación: validación/creación del token JWT, 
 * conexión del WebSocket y solicitud del OTP al servidor para mostrar el código QR.
 * 
 * @param {ApplicationV2} app - Instancia de la ventana de la interfaz de Foundry que se está renderizando.
 * @param {Array<Object>} controls - Matriz de botones/controles de la barra superior de la ventana.
 */
export function setupQrDialog(app, controls) {
    // Verificamos que la ventana pertenezca a un documento de tipo "Actor" (Personaje)
    if (!app.document || app.document.documentName !== "Actor") return;

    // Inyectamos nuestro botón al principio de la lista de controles
    controls.unshift({
        icon: "fa-solid fa-qrcode",
        label: "Role-Sync QR",
        tooltip: "Generar Código QR",
        action: "generateQr"
    });

    // Registramos la acción que se ejecutará al pulsar el botón
    if (!app.options.actions["generateQr"]) {
        
        /**
         * Función asíncrona que maneja el evento de clic en el botón del QR.
         * 
         * @async
         * @param {Event} event - El evento de clic del ratón.
         * @param {HTMLElement} target - El elemento HTML del botón pulsado.
         */
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

            // 2. Si no hay token válido para este personaje, creamos uno nuevo y lo guardamos
            if (!token) {
                token = await cryptoService.createToken(worldId, characterId);
                localStorage.setItem(CONFIG.TOKEN_KEY, token);
                console.log(`RoleSync | Creado nuevo token para el personaje: ${characterId}`);
            }

            // Evitamos desconectar y reconectar si el GM ya está usando este mismo personaje
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

            // 4. Solicitamos el OTP (One Time Password) al servidor backend
            const currentSocket = socketManager.getSocket();
            currentSocket.emit('GENERATE_OTP', {
                worldId,
                characterId,
                playerId: game.user.id,
                token
            }, async (res) => { 
                if (!res || !res.success) {
                    ui.notifications.error(`RoleSync | Error al solicitar OTP: ${res?.error || 'Sin respuesta'}`);
                    return;
                }

                const otp = res.otp;
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(otp)}`;

                // Compilamos la plantilla Handlebars inyectando las variables de UI
                const templatePath = `modules/${CONFIG.MODULE_ID}/templates/qr-dialog.hbs`;
                const contentHTML = await renderTemplate(templatePath, {
                    actorName: actor.name,
                    qrUrl: qrUrl,
                    otp: otp
                });

                // Renderizamos el diálogo de forma compatible con ApplicationV2 y Dialog clásico
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