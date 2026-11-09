import { getBase64Image } from "../utils/imageHelper.js";

/**
 * Procesa una solicitud de tirada de salvación enviada desde la aplicación móvil.
 * Busca al personaje en Foundry y lanza el diálogo o la tirada correspondiente.
 * 
 * @async
 * @param {Object} data - Carga útil (payload) enviada por el socket.
 * @param {string} data.characterId - ID del personaje objetivo de la tirada.
 * @param {string} data.ability - Abreviatura de la característica (ej. 'str', 'dex', 'con').
 * @param {string} activeCharacterId - ID del personaje actualmente vinculado a la sesión.
 */
export async function handleSavingThrow(data, activeCharacterId) {
    const { characterId: targetId, ability } = data;
    if (targetId !== activeCharacterId) return;
    const actor = game.actors.get(targetId);
    if (actor) await actor.rollSavingThrow({ ability });
}

/**
 * Procesa una solicitud de tirada de iniciativa enviada desde la aplicación móvil.
 * Si el personaje está en un combate activo, abre el diálogo de iniciativa y lo añade al encuentro.
 * 
 * @async
 * @param {Object} data - Carga útil (payload) enviada por el socket.
 * @param {string} data.characterId - ID del personaje objetivo.
 * @param {string} activeCharacterId - ID del personaje actualmente vinculado a la sesión.
 */
export async function handleInitiative(data, activeCharacterId) {
    const { characterId: targetId } = data;
    if (targetId !== activeCharacterId) return;
    const actor = game.actors.get(targetId);
    if (actor) await actor.rollInitiativeDialog({ createCombatants: true });
}

/**
 * Actualiza los puntos de golpe (HP) actuales del personaje en Foundry 
 * según la modificación realizada desde la aplicación móvil.
 * 
 * @param {Object} data - Carga útil (payload) enviada por el socket.
 * @param {string} data.characterId - ID del personaje a modificar.
 * @param {number} data.hp - Nuevo valor de puntos de golpe actuales.
 * @param {string} activeCharacterId - ID del personaje actualmente vinculado a la sesión.
 */
export function handleUpdateHp(data, activeCharacterId) {
    const { characterId: targetId, hp } = data;
    if (targetId !== activeCharacterId) return;
    const actor = game.actors.get(targetId);
    if (actor) actor.update({ "system.attributes.hp.value": hp });
}

/**
 * Actualiza los puntos de golpe temporales (Temp HP) del personaje en Foundry 
 * según la modificación realizada desde la aplicación móvil.
 * 
 * @param {Object} data - Carga útil (payload) enviada por el socket.
 * @param {string} data.characterId - ID del personaje a modificar.
 * @param {number} data.tempHp - Nuevo valor de puntos de golpe temporales.
 * @param {string} activeCharacterId - ID del personaje actualmente vinculado a la sesión.
 */
export function handleUpdateTempHp(data, activeCharacterId) {
    const { characterId: targetId, tempHp } = data;
    if (targetId !== activeCharacterId) return;
    const actor = game.actors.get(targetId);
    if (actor) actor.update({ "system.attributes.hp.temp": tempHp });
}

/**
 * Recopila todos los datos relevantes del personaje (Stats, HP, Avatar, Tiradas, Combate) 
 * cuando la aplicación móvil se conecta por primera vez, y los emite de vuelta a través del socket.
 * 
 * @async
 * @param {Object} data - Carga útil de la petición.
 * @param {string} data.characterId - ID bruto del personaje solicitado (puede venir prefijado por 'Actor.').
 * @param {string} activeCharacterId - ID del personaje validado por el token.
 * @param {Socket} socket - Instancia de Socket.io para emitir los datos de vuelta.
 */
export async function handleRequestCharacterData(data, activeCharacterId, socket) {
    const { characterId: targetId } = data;
    const cleanId = targetId.replace("Actor.", "");
    
    // Verificamos conexión
    if (cleanId !== activeCharacterId || !socket || !socket.connected) return;

    const actor = game.actors.get(cleanId);
    if (!actor) return;

    const sys = actor.system;
    
    // Usamos el helper importado
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
}

/**
 * Extrae los atributos base del Actor (Nivel, AC, Iniciativa, Velocidad, Competencia)
 * y los emite a la aplicación móvil mediante el evento 'PLAYER_UPDATE'.
 * 
 * @param {Actor} actor - Documento del Actor de Foundry VTT que ha sufrido cambios.
 * @param {string} activeCharacterId - ID del personaje vinculado actualmente.
 * @param {Socket} socket - Instancia de Socket.io conectada.
 */
export function emitPlayerUpdate(actor, activeCharacterId, socket) {
    if (!actor || actor.id !== activeCharacterId || !socket || !socket.connected) return;
    const sys = actor.system;
    
    socket.emit("PLAYER_UPDATE", {
        characterId: actor.id, 
        name: actor.name,
        level: sys.details?.level || 1, 
        ac: Number(sys.attributes?.ac?.value ?? 10),
        initiative: `${sys.attributes?.init?.total >= 0 ? '+' : ''}${sys.attributes?.init?.total ?? 0}`, 
        speed: sys.attributes?.movement?.walk || 0,
        proficiency: `+${sys.attributes?.prof ?? 2}`
    });
}

/**
 * Extrae el estado actual de salud del Actor (HP actuales, máximos y temporales)
 * y lo emite a la aplicación móvil mediante el evento 'HEALTH_UPDATE'.
 * 
 * @param {Actor} actor - Documento del Actor de Foundry VTT que ha sufrido cambios.
 * @param {string} activeCharacterId - ID del personaje vinculado actualmente.
 * @param {Socket} socket - Instancia de Socket.io conectada.
 */
export function emitHealthUpdate(actor, activeCharacterId, socket) {
    if (!actor || actor.id !== activeCharacterId || !socket || !socket.connected) return;
    
    socket.emit("HEALTH_UPDATE", {
        characterId: actor.id, 
        hp: actor.system.attributes.hp.value,
        maxHp: actor.system.attributes.hp.max, 
        tempHp: actor.system.attributes.hp.temp || 0
    });
}

/**
 * Verifica si el Actor se encuentra en un combate activo y si aún necesita tirar iniciativa.
 * Emite el resultado a la aplicación móvil mediante el evento 'COMBAT_STATE_UPDATE'.
 * 
 * @param {Actor} actor - Documento del Actor de Foundry VTT evaluado.
 * @param {string} activeCharacterId - ID del personaje vinculado actualmente.
 * @param {Socket} socket - Instancia de Socket.io conectada.
 */
export function checkAndSendCombatState(actor, activeCharacterId, socket) {
    if (!actor || actor.id !== activeCharacterId || !socket || !socket.connected) return;
    let canRoll = false;
    
    if (game.combat) {
        const combatant = game.combat.combatants.find(c => c.actor?.id === actor.id);
        if (combatant && (combatant.initiative === null || combatant.initiative === undefined)) canRoll = true;
    }
    
    socket.emit("COMBAT_STATE_UPDATE", { characterId: actor.id, inCombat: canRoll });
}