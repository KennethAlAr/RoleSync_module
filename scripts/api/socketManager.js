import { CONFIG } from "../config.js";
import { cryptoService } from "./cryptoService.js";
import { 
    handleSavingThrow, 
    handleInitiative, 
    handleUpdateHp, 
    handleUpdateTempHp, 
    handleRequestCharacterData 
} from "../game/characterSync.js";

let socket = null;
let activeCharacterId = null;

export const socketManager = {
    getSocket() {
        return socket;
    },

    getActiveCharacterId() {
        return activeCharacterId;
    },

    disconnect() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        activeCharacterId = null;
    },

    async connectWithToken(worldId, characterId, token) {
        if (!worldId || !characterId || !token) {
            console.warn("RoleSync | Faltan datos obligatorios para conectar con token.");
            return false;
        }

        if (!socket) {
            socket = io(CONFIG.SERVER_URL, { transports: ['websocket'] });
        } else if (!socket.connected) {
            socket.connect();
        }

        return new Promise((resolve) => {
            const setupAndAuthenticate = () => {
                socket.off('connect');
                socket.off('connect_error');

                console.log(`RoleSync | Socket listo (${socket.id}). Configurando escucha de validaciones...`);

                socket.off('VALIDATE_TOKEN'); 
                socket.on('VALIDATE_TOKEN', async (data, callback) => {
                    console.log("RoleSync | Petición VALIDATE_TOKEN recibida desde Render");

                    const validation = await cryptoService.validateToken(data.token, worldId);
                    const isValid = validation.isValid && validation.characterId === characterId;

                    console.log(`RoleSync | Resultado de validación local: ${isValid}`);
                    
                    if (typeof callback === 'function') {
                        callback({
                            isValid,
                            characterId: validation.characterId,
                            playerId: game.user.id
                        });
                    }
                });

                socket.emit('AUTHENTICATE_WITH_TOKEN', { token, worldId, characterId, clientType: 'foundry' }, (response) => {
                    if (response && response.success) {
                        console.log(`RoleSync | 🟢 Registrado correctamente en la sala: ${worldId}:${characterId}`);
                        this.setupSocketListeners(characterId);
                        resolve(true);
                    } else {
                        console.warn(`RoleSync | 🔴 Error al autenticar socket en Render: ${response?.error}`);
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
                    console.error("RoleSync | Error de conexión con Render:", err.message);
                    resolve(false);
                });
            }
        });
    },

    setupSocketListeners(characterId) {
        activeCharacterId = characterId;

        socket.off("ROLL_SAVING_THROW");
        socket.off("ROLL_INITIATIVE");
        socket.off("UPDATE_HP");
        socket.off("UPDATE_TEMP_HP");
        socket.off("REQUEST_CHARACTER_DATA");
        socket.off("REVOKE_TOKEN");

        socket.on("ROLL_SAVING_THROW", (data) => handleSavingThrow(data, activeCharacterId));
        socket.on("ROLL_INITIATIVE", (data) => handleInitiative(data, activeCharacterId));
        socket.on("UPDATE_HP", (data) => handleUpdateHp(data, activeCharacterId));
        socket.on("UPDATE_TEMP_HP", (data) => handleUpdateTempHp(data, activeCharacterId));
        socket.on("REQUEST_CHARACTER_DATA", (data) => handleRequestCharacterData(data, activeCharacterId, socket));

        socket.on('REVOKE_TOKEN', async (payload) => {
            console.log(`RoleSync | Petición de revocar token recibida para el personaje ${payload.characterId}.`);
            localStorage.removeItem(CONFIG.TOKEN_KEY);
            this.disconnect();
            console.log(`RoleSync | Socket desconectado en Foundry por desvinculación.`);
        });
    }
};