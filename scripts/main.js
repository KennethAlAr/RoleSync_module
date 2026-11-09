import { CONFIG } from "./config.js";
import { socketManager } from "./api/socketManager.js";
import { cryptoService } from "./api/cryptoService.js";
import { setupQrDialog } from "./ui/qrDialog.js";
import { registerEventRouter } from "./game/eventRouter.js";

/**
 * Hook 'init' de Foundry VTT.
 * Se dispara durante la fase inicial de arranque del cliente, antes de que el mundo cargue.
 * Registra la configuración persistente del módulo (World ID) en la base de datos.
 */
Hooks.once('init', function() {
    console.log("==========================================");
    console.log("RoleSync | Inicializando plugin backend...");
    console.log("==========================================");

    // Registramos la propiedad en la base de datos del mundo (oculta en la UI)
    game.settings.register(CONFIG.MODULE_ID, CONFIG.SETTING_WORLD_ID, {
        name: 'World Sync ID',
        scope: 'world',
        config: false,
        type: String,
        default: ''
    });
});

/**
 * Hook 'ready' de Foundry VTT.
 * Se dispara cuando todo el lienzo, actores y datos del mundo han terminado de cargar.
 * Se encarga de gestionar el identificador único de la partida, activar los listeners 
 * de eventos de D&D e intentar una reconexión silenciosa mediante el token guardado.
 * 
 * @async
 */
Hooks.once('ready', async function() {
    // Listener para desconectar el socket limpiamente cuando el usuario pulsa F5 o cierra la pestaña
    window.addEventListener('beforeunload', () => {
        socketManager.disconnect();
    });

    // 1. Obtenemos o generamos el ID único del mundo
    let worldId = game.settings.get(CONFIG.MODULE_ID, CONFIG.SETTING_WORLD_ID);

    if (game.user.isGM && !worldId) {
        worldId = foundry.utils.randomID(6);
        await game.settings.set(CONFIG.MODULE_ID, CONFIG.SETTING_WORLD_ID, worldId);
        console.log(`RoleSync | Generado y guardado nuevo worldId: ${worldId}`);
    } else if (worldId) {
        console.log(`RoleSync | WorldId existente recuperado: ${worldId}`);
    }

    if (!worldId) return;

    // 2. Activamos el enrutador de eventos (Hooks de daño, iniciativa, stats)
    registerEventRouter();

    // 3. Intentamos reconexión automática si el usuario ya estaba vinculado
    const savedToken = localStorage.getItem(CONFIG.TOKEN_KEY);
    if (!savedToken) return;

    const validation = await cryptoService.validateToken(savedToken, worldId);

    if (!validation.isValid) {
        console.warn("RoleSync | Token inválido o expirado:", validation.error);
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        return;
    }

    console.log(`RoleSync | Token verificado para el personaje: ${validation.characterId}`);
    
    // 4. Conectamos evaluando la respuesta limpia (true/false)
    const connected = await socketManager.connectWithToken(worldId, validation.characterId, savedToken);
    
    if (!connected) {
        console.warn(`RoleSync | No se pudo reconectar automáticamente al servidor para el personaje ${validation.characterId}.`);
    }
});

/**
 * Hook 'getHeaderControlsApplicationV2' de Foundry VTT.
 * Intercepta la renderización de la cabecera de las ventanas de tipo ApplicationV2.
 * Si la ventana pertenece a un Actor, delega la inyección del botón QR al gestor de UI.
 * 
 * @param {object} app - Instancia de la aplicación que se está renderizando.
 * @param {Array<object>} controls - Matriz de controles/botones de la cabecera de la ventana.
 */
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    // Delegamos la inyección del botón y la lógica del código QR al módulo UI
    setupQrDialog(app, controls);
});