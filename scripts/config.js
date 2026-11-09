/**
 * Objeto que contiene la configuración estática del cliente de Foundry VTT.
 * 
 * @constant {Object} CONFIG
 * @property {string} SERVER_URL - La URL base del servidor backend (Node.js/Socket.io) desplegado en Render.
 * @property {string} MODULE_ID - El identificador único del módulo. Debe coincidir exactamente con el campo "id" de module.json.
 * @property {string} TOKEN_KEY - La clave utilizada para guardar y recuperar el JWT de autenticación en el LocalStorage del navegador.
 * @property {string} SETTING_WORLD_ID - La clave registrada en los ajustes de Foundry VTT para persistir el ID único de la partida vinculada.
 */
export const CONFIG = {
    SERVER_URL: "https://rolesync-server.onrender.com",
    MODULE_ID: "rolesync",
    TOKEN_KEY: "rolesync_token",
    SETTING_WORLD_ID: "worldSyncId"
};