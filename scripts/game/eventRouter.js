import { socketManager } from "../api/socketManager.js";
import { 
    emitPlayerUpdate, 
    emitHealthUpdate, 
    checkAndSendCombatState 
} from "./characterSync.js";

/**
 * Registra todos los Hooks nativos de Foundry VTT.
 * Actúa como un enrutador que intercepta los cambios locales en el mundo 
 * (modificación de hojas de personaje, equipamiento, estados y turnos de combate)
 * y delega la emisión de estos cambios hacia la aplicación móvil en tiempo real.
 */
export function registerEventRouter() {
    
    /**
     * Hook 'updateActor'.
     * Se dispara cuando cambian los atributos principales de un personaje (vida, iniciativa, armadura, etc.).
     */
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
    
    /**
     * Función controladora unificada para cambios en el inventario o efectos activos.
     * Extrae el Actor propietario del objeto/efecto y evalúa si necesita actualizar sus estadísticas en la app.
     * 
     * @param {Document} doc - El documento modificado (Item o ActiveEffect) dentro de Foundry VTT.
     */
    const handleItemOrEffect = (doc) => { 
        const socket = socketManager.getSocket();
        const activeCharacterId = socketManager.getActiveCharacterId();
        
        // Dependiendo de la versión de Foundry o tipo de documento, el padre puede estar en doc.parent o doc.actor
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
    
    /**
     * Función adaptadora que extrae las dependencias de socket y personaje activo,
     * y delega la verificación del estado de combate (si el personaje debe tirar iniciativa).
     * 
     * @param {Actor} actor - El documento del Actor implicado en el combate.
     */
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