import { getBase64Image } from "../utils/imageHelper.js";

// ==========================================
// RECEPCIÓN: ORDENES DESDE LA APP MÓVIL
// ==========================================

export async function handleSavingThrow(data, activeCharacterId) {
    const { characterId: targetId, ability } = data;
    if (targetId !== activeCharacterId) return;
    const actor = game.actors.get(targetId);
    if (actor) await actor.rollSavingThrow({ ability });
}

export async function handleInitiative(data, activeCharacterId) {
    const { characterId: targetId } = data;
    if (targetId !== activeCharacterId) return;
    const actor = game.actors.get(targetId);
    if (actor) await actor.rollInitiativeDialog({ createCombatants: true });
}

export function handleUpdateHp(data, activeCharacterId) {
    const { characterId: targetId, hp } = data;
    if (targetId !== activeCharacterId) return;
    const actor = game.actors.get(targetId);
    if (actor) actor.update({ "system.attributes.hp.value": hp });
}

export function handleUpdateTempHp(data, activeCharacterId) {
    const { characterId: targetId, tempHp } = data;
    if (targetId !== activeCharacterId) return;
    const actor = game.actors.get(targetId);
    if (actor) actor.update({ "system.attributes.hp.temp": tempHp });
}

// ==========================================
// EXTRACCIÓN: DATOS COMPLETOS (CONEXIÓN)
// ==========================================

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

// ==========================================
// EMISIÓN: ACTUALIZACIONES EN TIEMPO REAL
// ==========================================

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

export function emitHealthUpdate(actor, activeCharacterId, socket) {
    if (!actor || actor.id !== activeCharacterId || !socket || !socket.connected) return;
    
    socket.emit("HEALTH_UPDATE", {
        characterId: actor.id, 
        hp: actor.system.attributes.hp.value,
        maxHp: actor.system.attributes.hp.max, 
        tempHp: actor.system.attributes.hp.temp || 0
    });
}

export function checkAndSendCombatState(actor, activeCharacterId, socket) {
    if (!actor || actor.id !== activeCharacterId || !socket || !socket.connected) return;
    let canRoll = false;
    
    if (game.combat) {
        const combatant = game.combat.combatants.find(c => c.actor?.id === actor.id);
        if (combatant && (combatant.initiative === null || combatant.initiative === undefined)) canRoll = true;
    }
    
    socket.emit("COMBAT_STATE_UPDATE", { characterId: actor.id, inCombat: canRoll });
}