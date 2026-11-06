// Configuración del servidor
const SERVER_URL = "https://rolesync-server.onrender.com"; 

// Variables globales
let socket = null;

// Helpers internos para codificación Base64Url nativa
const base64UrlEncode = (buffer) => {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const base64UrlDecode = (str) => {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return atob(base64);
};

/**
 * Genera un JWT firmado con el worldId usando HMAC SHA-256
 */
async function createToken(worldId, characterId) {
    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
        worldId,
        characterId,
        iat: Math.floor(Date.now() / 1000)
    };

    const enc = new TextEncoder();
    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(worldId),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(dataToSign));
    return `${dataToSign}.${base64UrlEncode(signature)}`;
}

/**
 * Valida un JWT comprobando su firma con el worldId y extrayendo sus datos
 */
async function validateToken(token, expectedWorldId) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return { isValid: false, error: 'Formato de token inválido' };

        const [encodedHeader, encodedPayload, signature] = parts;
        const dataToSign = `${encodedHeader}.${encodedPayload}`;
        const enc = new TextEncoder();

        const key = await crypto.subtle.importKey(
            "raw",
            enc.encode(expectedWorldId),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"]
        );

        const binarySignature = Uint8Array.from(base64UrlDecode(signature), c => c.charCodeAt(0));
        const isValid = await crypto.subtle.verify("HMAC", key, binarySignature, enc.encode(dataToSign));

        if (!isValid) return { isValid: false, error: 'Firma inválida' };

        const payload = JSON.parse(base64UrlDecode(encodedPayload));
        if (payload.worldId !== expectedWorldId) {
            return { isValid: false, error: 'El worldId no coincide' };
        }

        return {
            isValid: true,
            worldId: payload.worldId,
            characterId: payload.characterId
        };
    } catch (err) {
        return { isValid: false, error: err.message };
    }
}

/**
- Conecta Foundry al servidor de Render reutilizando un token existente,
- configura la validación y activa los oyentes de eventos.
 */
async function connectWithToken(worldId, characterId, token) {
    if (!worldId || !characterId || !token) {
        console.warn("TFG Sync | Faltan datos obligatorios para conectar con token.");
        return false;
    }

    // 1. Si el socket no existe lo instanciamos; si existe pero está desconectado, forzamos .connect()
    if (!socket) {
        socket = io(SERVER_URL, { transports: ['websocket'] });
    } else if (!socket.connected) {
        socket.connect();
    }

    return new Promise((resolve) => {
        const setupAndAuthenticate = () => {
            // Limpiamos oyentes de conexión previa para evitar ejecuciones duplicadas
            socket.off('connect');
            socket.off('connect_error');

            console.log(`TFG Sync | Socket listo (${socket.id}). Configurando escucha de validaciones...`);

            // 2. Escuchador de VALIDATE_TOKEN
            socket.off('VALIDATE_TOKEN'); 
            socket.on('VALIDATE_TOKEN', async (data, callback) => {
                console.log("TFG Sync | 📥 Petición VALIDATE_TOKEN recibida desde Render");

                const validation = await validateToken(data.token, worldId);
                const isValid = validation.isValid && validation.characterId === characterId;

                console.log(`TFG Sync | Resultado de validación local: ${isValid}`);
                
                if (typeof callback === 'function') {
                    callback({
                        isValid,
                        characterId: validation.characterId,
                        playerId: game.user.id
                    });
                }
            });

            // 3. Notificamos al servidor
            socket.emit('AUTHENTICATE_WITH_TOKEN', { token, worldId, characterId, clientType: 'foundry' }, (response) => {
                if (response && response.success) {
                    console.log(`TFG Sync | 🟢 Registrado correctamente en la sala: ${worldId}:${characterId}`);
                    setupSocketListeners(characterId);
                    resolve(true);
                } else {
                    console.warn(`TFG Sync | 🔴 Error al autenticar socket en Render: ${response?.error}`);
                    resolve(false);
                }
            });
        };

        if (socket.connected) {
            setupAndAuthenticate();
        } else {
            socket.off('connect');
            socket.off('connect_error');
            
            socket.once('connect', setupAndAuthenticate);
            socket.once('connect_error', (err) => {
                console.error("TFG Sync | Error de conexión con Render:", err.message);
                resolve(false);
            });
        }
    });
}

Hooks.once('init', function() {
    console.log("==========================================");
    console.log("TFG Sync | Inicializando plugin backend...");
    console.log("==========================================");

    // Registramos la propiedad en la base de datos del mundo (oculta en la UI)
    game.settings.register('rolesync', 'worldSyncId', {
        name: 'World Sync ID',
        scope: 'world',
        config: false,
        type: String,
        default: ''
    });
});

Hooks.once('ready', async function() {
    // Escuchador para desconectar el socket limpiamente cuando el usuario pulsa F5 o cierra la pestaña
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.disconnect();
        }
    });

    let worldId = game.settings.get('rolesync', 'worldSyncId');

    if (game.user.isGM && !worldId) {
        worldId = foundry.utils.randomID(6);
        await game.settings.set('rolesync', 'worldSyncId', worldId);
        console.log(`TFG Sync | Generado y guardado nuevo worldId: ${worldId}`);
    } else if (worldId) {
        console.log(`TFG Sync | WorldId existente recuperado: ${worldId}`);
    }

    if (!worldId) return;

    const savedToken = localStorage.getItem('rolesync_token');
    if (!savedToken) return;

    const validation = await validateToken(savedToken, worldId);

    if (!validation.isValid) {
        console.warn("TFG Sync | Token inválido o expirado:", validation.error);
        localStorage.removeItem('rolesync_token');
        return;
    }

    console.log(`TFG Sync | Token verificado para el personaje: ${validation.characterId}`);
    await connectWithToken(worldId, validation.characterId, savedToken);
});

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
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

            const worldId = game.settings.get('rolesync', 'worldSyncId');
            if (!worldId) {
                ui.notifications.error("TFG Sync | No se ha encontrado el World ID de la partida.");
                return;
            }

            const characterId = actor.id;
            let token = localStorage.getItem('rolesync_token');

            // 1. Comprobamos si el token existente es válido y pertenece a este personaje
            if (token) {
                const validation = await validateToken(token, worldId);
                if (!validation.isValid || validation.characterId !== characterId) {
                    token = null; 
                }
            }

            // 2. Si no hay token válido para este personaje, creamos uno nuevo
            if (!token) {
                token = await createToken(worldId, characterId);
                localStorage.setItem('rolesync_token', token);
                console.log(`TFG Sync | Creado nuevo token para el personaje: ${characterId}`);
            }

            // 👇 NUEVA COMPROBACIÓN INTELIGENTE 👇
            // Si el socket ya está conectado y es el mismo personaje, nos saltamos la reconexión innecesaria
            let connected = socket && socket.connected && activeCharacterId === characterId;

            if (!connected) {
                // 3. Conectamos el socket a Render solo si no estaba ya conectado
                connected = await connectWithToken(worldId, characterId, token);
                if (!connected) {
                    ui.notifications.error("TFG Sync | No se pudo conectar con el servidor de Role-Sync.");
                    return;
                }
            } else {
                console.log("TFG Sync | Socket ya activo para este personaje, reutilizando conexión...");
            }

            // 4. Solicitamos el OTP a Render
            socket.emit('GENERATE_OTP', {
                worldId,
                characterId,
                playerId: game.user.id,
                token
            }, (res) => {
                if (!res || !res.success) {
                    ui.notifications.error(`TFG Sync | Error al solicitar OTP: ${res?.error || 'Sin respuesta'}`);
                    return;
                }

                const otp = res.otp;
                // Generamos la URL del QR pasando únicamente el string del OTP
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(otp)}`;

                const contentHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 10px;">
                        <p style="margin-bottom: 10px;">Escanea este código o introduce el PIN desde la app para vincular a <strong>${actor.name}</strong>:</p>
                        
                        <img src="${qrUrl}" alt="QR Code" style="border: 2px solid #7a7971; border-radius: 8px; width: 200px; height: 200px; background: white; padding: 5px; display: block; margin: 0 auto 15px auto;" />
                        
                        <div style="background: #111; color: #00ffcc; font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 4px; padding: 8px 16px; border-radius: 6px; border: 1px solid #333;">
                            ${otp}
                        </div>
                    </div>
                `;

                // Renderizamos el diálogo según la versión de la API de Foundry
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
});

// Variable global para saber qué personaje está sincronizando este cliente
let activeCharacterId = null;

function setupSocketListeners(characterId) {
    activeCharacterId = characterId;

    // Limpiamos oyentes antiguos para evitar ejecuciones duplicadas si hay reconexiones
    socket.off("ROLL_SAVING_THROW");
    socket.off("ROLL_INITIATIVE");
    socket.off("UPDATE_HP");
    socket.off("UPDATE_TEMP_HP");
    socket.off("REQUEST_CHARACTER_DATA");
    socket.off("REVOKE_TOKEN");

    // 1. Tirada de Salvación desde el móvil
    socket.on("ROLL_SAVING_THROW", async ({ characterId: targetId, ability }) => {
        if (targetId !== activeCharacterId) return;
        const actor = game.actors.get(targetId);
        if (actor) await actor.rollSavingThrow({ ability });
    });

    // 2. Tirada de Iniciativa desde el móvil
    socket.on("ROLL_INITIATIVE", async ({ characterId: targetId }) => {
        if (targetId !== activeCharacterId) return;
        const actor = game.actors.get(targetId);
        if (actor) await actor.rollInitiativeDialog({ createCombatants: true });
    });

    // 3. Modificación de HP desde el móvil
    socket.on("UPDATE_HP", ({ characterId: targetId, hp }) => {
        if (targetId !== activeCharacterId) return;
        const actor = game.actors.get(targetId);
        if (actor) actor.update({ "system.attributes.hp.value": hp });
    });

    socket.on("UPDATE_TEMP_HP", ({ characterId: targetId, tempHp }) => {
        if (targetId !== activeCharacterId) return;
        const actor = game.actors.get(targetId);
        if (actor) actor.update({ "system.attributes.hp.temp": tempHp });
    });

    // 4. Petición de datos completos al conectar el móvil
    socket.on("REQUEST_CHARACTER_DATA", async ({ characterId: targetId }) => {
        const cleanId = targetId.replace("Actor.", "");
        if (cleanId !== activeCharacterId) return;

        const actor = game.actors.get(cleanId);
        if (!actor) return;

        const sys = actor.system;
        const avatarBase64 = actor.prototypeToken?.texture?.src 
            ? await getBase64Image(actor.prototypeToken.texture.src) 
            : null;
            
        const classItem = actor.items.find(i => i.type === 'class');
        const className = classItem ? classItem.name : 'Aventurero';
        const level = classItem?.system?.levels || sys.details?.level || 1;

        const abilityNames = { str: 'FUE', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
        const savingThrows = Object.entries(sys.abilities || {}).map(([key, ab]) => {
            const abilityMod = Math.floor(((ab.value ?? 10) - 10) / 2);
            const profBonus = ab.proficient ? (sys.attributes?.prof ?? 2) : 0;
            let totalMod = abilityMod + profBonus;
            if (ab.save && typeof ab.save === 'object' && typeof ab.save.bonus === 'number') totalMod += ab.save.bonus;
            return { 
                name: abilityNames[key] || key.toUpperCase(), 
                mod: totalMod >= 0 ? `+${totalMod}` : `${totalMod}`, 
                proficient: Boolean(ab.proficient) 
            };
        });

        const combatant = game.combat?.combatants.find(c => c.actor?.id === actor.id);
        const inCombat = combatant ? (combatant.initiative === null || combatant.initiative === undefined) : false;

        socket.emit("PLAYER_INFO", {
            characterId: cleanId, name: actor.name, className, level, avatarImage: avatarBase64,
            ac: sys.attributes?.ac?.value ?? 10,
            initiative: `${sys.attributes?.init?.mod >= 0 ? '+' : ''}${sys.attributes?.init?.mod ?? 0}`,
            speed: sys.attributes?.movement?.walk ?? 30, proficiency: `+${sys.attributes?.prof ?? 2}`, inCombat
        });

        socket.emit("HEALTH_INFO", {
            characterId: cleanId, hp: sys.attributes?.hp?.value ?? 0,
            maxHp: sys.attributes?.hp?.max ?? 0, tempHp: sys.attributes?.hp?.temp ?? 0
        });

        socket.emit("SAVING_THROWS_INFO", { characterId: cleanId, savingThrows });
    });

    socket.on('REVOKE_TOKEN', async (payload) => {
        console.log(`TFG Sync | 🗑️ Petición de revocar token recibida para el personaje ${payload.characterId}.`);
        
        // 1. Borramos el token de la memoria del navegador de Foundry
        localStorage.removeItem('rolesync_token');
        
        // 2. Cerramos la conexión del socket en el lado de Foundry
        if (socket) {
            socket.disconnect();
            console.log(`TFG Sync | 🔌 Socket desconectado en Foundry por desvinculación.`);
        }

        // 3. (Opcional) Si tenías el QR abierto en la pantalla de Foundry, 
        // aquí podrías lanzar la orden de cerrar esa ventana o actualizar la UI.
    });
}

// Helper de conversión de imágenes
async function getBase64Image(url) {
    try {
        let finalUrl = url;
        if (finalUrl.includes('*')) {
            const folderPath = finalUrl.replace(/\/\*$/, '').replace(/^\//, '');
            const browseResult = await FilePicker.browse("data", folderPath);
            if (browseResult && browseResult.files && browseResult.files.length > 0) {
                const firstImage = browseResult.files.find(f => /\.(png|webp|jpg|jpeg|svg|gif)$/i.test(f));
                if (firstImage) finalUrl = firstImage;
            }
        }
        const response = await fetch(finalUrl);
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.warn("[PLUGIN TFG] Error al convertir la imagen a Base64:", error);
        return null;
    }
}

// ==========================================
// HOOKS DE EMISIÓN EN TIEMPO REAL AL MÓVIL
// ==========================================

function emitPlayerUpdate(actor) {
    if (!actor || actor.id !== activeCharacterId || !socket || !socket.connected) return;
    const sys = actor.system;
    socket.emit("PLAYER_UPDATE", {
        characterId: actor.id, name: actor.name,
        level: sys.details?.level || 1, ac: Number(sys.attributes?.ac?.value ?? 10),
        initiative: `${sys.attributes?.init?.total >= 0 ? '+' : ''}${sys.attributes?.init?.total ?? 0}`, 
        speed: sys.attributes?.movement?.walk || 0,
        proficiency: `+${sys.attributes?.prof ?? 2}`
    });
}

Hooks.on("updateActor", (actor, changes) => {
    if (actor.id !== activeCharacterId || !socket || !socket.connected) return;

    if (changes.system?.attributes?.hp !== undefined) {
        socket.emit("HEALTH_UPDATE", {
            characterId: actor.id, 
            hp: actor.system.attributes.hp.value,
            maxHp: actor.system.attributes.hp.max, 
            tempHp: actor.system.attributes.hp.temp || 0
        });
    }

    const hasPlayerChanges = changes.system?.attributes?.ac !== undefined || 
                             changes.system?.attributes?.init !== undefined || 
                             changes.system?.attributes?.movement !== undefined || 
                             changes.system?.details?.level !== undefined || 
                             changes.system?.attributes?.prof !== undefined || 
                             changes.name !== undefined;

    if (hasPlayerChanges) emitPlayerUpdate(actor);
});

const handleItemOrEffect = (doc) => { 
    const targetActor = doc.parent || doc.actor;
    if (targetActor && targetActor.id === activeCharacterId) emitPlayerUpdate(targetActor); 
};

Hooks.on("updateItem", handleItemOrEffect); 
Hooks.on("createItem", handleItemOrEffect); 
Hooks.on("deleteItem", handleItemOrEffect);
Hooks.on("createActiveEffect", handleItemOrEffect); 
Hooks.on("deleteActiveEffect", handleItemOrEffect); 
Hooks.on("updateActiveEffect", handleItemOrEffect);

function checkAndSendCombatState(actor) {
    if (!actor || actor.id !== activeCharacterId || !socket || !socket.connected) return;
    let canRoll = false;
    if (game.combat) {
        const combatant = game.combat.combatants.find(c => c.actor?.id === actor.id);
        if (combatant && (combatant.initiative === null || combatant.initiative === undefined)) canRoll = true;
    }
    socket.emit("COMBAT_STATE_UPDATE", { characterId: actor.id, inCombat: canRoll });
}

Hooks.on("createCombat", (combat) => combat.combatants.forEach(c => checkAndSendCombatState(c.actor)));
Hooks.on("deleteCombat", (combat) => combat.combatants.forEach(c => checkAndSendCombatState(c.actor)));
Hooks.on("updateCombat", (combat) => combat.combatants.forEach(c => checkAndSendCombatState(c.actor)));
Hooks.on("createCombatant", (combatant) => checkAndSendCombatState(combatant.actor));
Hooks.on("deleteCombatant", (combatant) => checkAndSendCombatState(combatant.actor));
Hooks.on("updateCombatant", (combatant, changes) => { if (changes.initiative !== undefined) checkAndSendCombatState(combatant.actor); });