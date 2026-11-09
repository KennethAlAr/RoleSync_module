import { socketManager } from "../api/socketManager.js";
import { 
    emitPlayerUpdate, 
    emitHealthUpdate, 
    checkAndSendCombatState 
} from "./characterSync.js";

/**
 * Registra todos los oyentes de eventos de Foundry VTT para reaccionar a 
 * cambios en la hoja del personaje, inventario, efectos y estado de combate.
 */
export function registerEventRouter() {

    // ==========================================
    // 1. ACTUALIZACIONES DIRECTAS DEL ACTOR (Stats y HP)
    // ==========================================
    Hooks.on("updateActor", (actor, changes) => {
        const socket = socketManager.getSocket();
        const activeCharacterId = socketManager.getActiveCharacterId();
        
        if (actor.id !== activeCharacterId || !socket || !socket.connected) return;

        // Si hay cambios en la vida (HP)
        if (changes.system?.attributes?.hp !== undefined) {
            emitHealthUpdate(actor, activeCharacterId, socket);
        }

        // Si hay cambios en atributos base (Armor Class, Iniciativa, Movimiento, Nivel, Nombre...)
        const hasPlayerChanges = changes.system?.attributes?.ac !== undefined || 
                                 changes.system?.attributes?.init !== undefined || 
                                 changes.system?.attributes?.movement !== undefined || 
                                 changes.system?.details?.level !== undefined || 
                                 changes.system?.attributes?.prof !== undefined || 
                                 changes.name !== undefined;

        if (hasPlayerChanges) {
            emitPlayerUpdate(actor, activeCharacterId, socket);
        }
    });

    // ==========================================
    // 2. ACTUALIZACIONES INDIRECTAS (Objetos y Efectos)
    // ==========================================
    const handleItemOrEffect = (doc) => { 
        const socket = socketManager.getSocket();
        const activeCharacterId = socketManager.getActiveCharacterId();
        
        const targetActor = doc.parent || doc.actor;
        if (targetActor && targetActor.id === activeCharacterId) {
            emitPlayerUpdate(targetActor, activeCharacterId, socket); 
        }
    };

    Hooks.on("updateItem", handleItemOrEffect); 
    Hooks.on("createItem", handleItemOrEffect); 
    Hooks.on("deleteItem", handleItemOrEffect);
    Hooks.on("createActiveEffect", handleItemOrEffect); 
    Hooks.on("deleteActiveEffect", handleItemOrEffect); 
    Hooks.on("updateActiveEffect", handleItemOrEffect);

    // ==========================================
    // 3. ACTUALIZACIONES DE COMBATE (Iniciativa)
    // ==========================================
    
    // Función adaptadora para inyectar las dependencias sin repetir código
    const handleCombatState = (actor) => {
        const socket = socketManager.getSocket();
        const activeCharacterId = socketManager.getActiveCharacterId();
        checkAndSendCombatState(actor, activeCharacterId, socket);
    };

    Hooks.on("createCombat", (combat) => combat.combatants.forEach(c => handleCombatState(c.actor)));
    Hooks.on("deleteCombat", (combat) => combat.combatants.forEach(c => handleCombatState(c.actor)));
    Hooks.on("updateCombat", (combat) => combat.combatants.forEach(c => handleCombatState(c.actor)));
    Hooks.on("createCombatant", (combatant) => handleCombatState(combatant.actor));
    Hooks.on("deleteCombatant", (combatant) => handleCombatState(combatant.actor));
    
    Hooks.on("updateCombatant", (combatant, changes) => { 
        if (changes.initiative !== undefined) {
            handleCombatState(combatant.actor); 
        }
    });
}