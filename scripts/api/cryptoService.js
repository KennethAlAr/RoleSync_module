const base64UrlEncode = (buffer) => {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const base64UrlDecode = (str) => {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return atob(base64);
};

export const cryptoService = {
    /**
     * Genera un JWT firmado con el worldId usando HMAC SHA-256
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
     * Valida un JWT comprobando su firma con el worldId y extrayendo sus datos
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