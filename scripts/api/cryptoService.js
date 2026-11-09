/**
 * Convierte un ArrayBuffer a una cadena Base64Url (URL-safe).
 * Reemplaza los caracteres no seguros en URLs ('+', '/') y elimina el relleno ('=').
 * 
 * @private
 * @param {ArrayBuffer} buffer - Los datos binarios (como la firma criptográfica) a codificar.
 * @returns {string} La cadena codificada en formato Base64Url.
 */
const base64UrlEncode = (buffer) => {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

/**
 * Decodifica una cadena Base64Url devolviéndola a su formato binario original (representado en string).
 * Restaura los caracteres estándar de Base64 y añade el relleno ('=') necesario para la decodificación.
 * 
 * @private
 * @param {string} str - La cadena en formato Base64Url.
 * @returns {string} Los datos decodificados mediante atob().
 */
const base64UrlDecode = (str) => {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return atob(base64);
};

export const cryptoService = {
    /**
     * Genera un JSON Web Token (JWT) firmado digitalmente.
     * El token incluye en su carga útil (payload) el ID del mundo, el ID del personaje y 
     * la marca de tiempo de creación (iat). La firma garantiza que el token no ha sido alterado.
     * 
     * @async
     * @param {string} worldId - El identificador único de la partida (usado también como secreto de firma).
     * @param {string} characterId - El identificador del Actor (personaje) de Foundry VTT.
     * @returns {Promise<string>} El token JWT completo en formato (header.payload.signature).
     */
    async createToken(worldId, characterId) {
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
    },

    /**
     * Valida un JWT comprobando su estructura, su firma criptográfica y que pertenezca a la partida actual.
     * 
     * @async
     * @param {string} token - El JWT completo a verificar.
     * @param {string} expectedWorldId - El ID de la partida actual, utilizado para verificar la firma.
     * @returns {Promise<{isValid: boolean, error?: string, worldId?: string, characterId?: string}>} 
     * Un objeto que indica si es válido y, en caso afirmativo, los datos extraídos; si falla, incluye el motivo del error.
     */
    async validateToken(token, expectedWorldId) {
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
};