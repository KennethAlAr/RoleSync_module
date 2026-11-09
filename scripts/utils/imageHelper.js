/**
 * Convierte la URL de una imagen (o la primera imagen de un directorio) a formato Base64.
 * 
 * @param {string} url - La ruta de la imagen o directorio en Foundry.
 * @returns {Promise<string|null>} La cadena en Base64 o null en caso de error.
 */
export async function getBase64Image(url) {
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
        console.warn("RoleSync | Error al convertir la imagen a Base64:", error);
        return null;
    }
}