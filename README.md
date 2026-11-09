# ¿Qué es RoleSync?

RoleSync es un ecosistema interactivo diseñado para modernizar las partidas de rol de mesa. Conecta en tiempo real el tablero virtual de Foundry VTT con los teléfonos móviles de los jugadores, convirtiendo sus dispositivos en hojas de personaje interactivas. El sistema permite realizar tiradas, actualizar puntos de vida y gestionar el estado del combate de forma sincronizada bidireccionalmente y sin latencia.

# RoleSync - Foundry VTT Module

![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=for-the-badge&logo=css3&logoColor=white)
![Handlebars.js](https://img.shields.io/badge/Handlebars.js-f0772b?style=for-the-badge&logo=handlebarsdotjs&logoColor=black)
![Socket.io](https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&badgeColor=010101)
![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v13-ff6400?style=for-the-badge)

Módulo oficial para Foundry VTT del ecosistema **RoleSync**. Se integra directamente en la interfaz del Dungeon Master y los jugadores, interceptando eventos de la partida en tiempo real y gestionando la vinculación segura mediante códigos QR para la app móvil.

## Ecosistema RoleSync y Orden de Ejecución

Este repositorio es una de las tres piezas que componen el Trabajo de Fin de Grado (TFG). Para que el sistema funcione correctamente, los componentes deben iniciarse en el siguiente orden:

1. [**RoleSync Server**](https://github.com/KennethAlAr/RoleSync_server)**:** Servidor Node.js intermediario (Relay Server) que gestiona los WebSockets. *(Se inicia primero)*.
2. **RoleSync Foundry Module (Este repositorio):** Módulo instalado en el VTT del Dungeon Master. Se conecta al servidor, detecta los cambios del juego y genera el código QR de vinculación.
3. [**RoleSync Mobile App**](https://github.com/KennethAlAr/RoleSync_frontend)**:** Aplicación del jugador. Escanea el QR para establecer el túnel en tiempo real.

## Requisitos Previos

Para instalar y ejecutar este módulo necesitas:

* **Foundry Virtual Tabletop:** Versión 13 (Recomendado build 351).
* **Sistema de Juego:** Dungeons & Dragons 5e (`dnd5e`).
* **Conexión a Internet:** Para alcanzar el servidor Relay desplegado, o configuración en red local si el servidor corre en tu misma máquina.

## Instalación y Configuración

Dado que este módulo está en fase de desarrollo para un TFG y no está publicado en el bazar oficial de Foundry, la instalación se realiza de forma manual:

1. **Clonar el repositorio:**
   Clona este repositorio directamente en la carpeta de módulos de tu instancia de Foundry VTT (ubicada en `Data/modules/`).

   ```bash
   cd Ruta/A/Tu/FoundryVTT/Data/modules/
   git clone https://github.com/tu-usuario/rolesync-foundry.git rolesync
   ```
   *(Nota: Es de vital importancia que la carpeta final se llame exactamente `rolesync` para coincidir con el identificador del `module.json`).*

2. **Configurar el servidor destino (Opcional):**
   Por defecto, el módulo apunta al servidor de producción. Si deseas probarlo en local, abre el archivo `scripts/config.js` y modifica la constante `SERVER_URL` para que apunte a tu IP local (ej. `http://192.168.1.33:3000`).

## Activación y Uso en la Partida

1. Inicia Foundry VTT y accede a tu mundo con permisos de **Dungeon Master (Gamemaster)**.
2. Ve a la pestaña de **Configuración de Juego (Game Settings)** -> **Gestionar Módulos (Manage Modules)**.
3. Busca **RoleSync** en la lista, marca la casilla para activarlo y guarda los cambios (el mundo se recargará automáticamente).
4. Abre la ficha de cualquier **Actor** (Personaje) del que seas dueño. En la barra superior (cabecera) verás un nuevo botón con el icono de un código QR dentro del menú de acciones (Botón **⋮**).
5. Pulsa el botón para generar un token criptográfico seguro y solicitar el OTP/QR al servidor. Vincula desde la app móvil.

## Arquitectura Técnica Destacada

El módulo actúa como el motor de sincronización del ecosistema, integrándose de forma nativa y no intrusiva en Foundry VTT para actuar como la fuente de verdad (Source of Truth) y retransmitir el estado del juego en tiempo real:

* **Arquitectura Modular (ES Modules):** Uso estricto del estándar ECMAScript 6 (`import/export`) para la separación de responsabilidades (Principio SRP) dividiendo el sistema en capas: Interfaz de Usuario, Lógica de Juego, Comunicaciones de Red y Utilidades.
* **Criptografía Nativa (Web Crypto API):** Implementación de la generación, firma y validación de tokens JWT desde cero utilizando `crypto.subtle` (HMAC SHA-256). Esto garantiza la máxima seguridad sin añadir dependencias externas (*Zero Dependencies*).
* **Patrón de Enrutador de Eventos (Hooks):** Centralización de todos los escuchadores del ciclo de vida de Foundry (`updateActor`, `updateItem`, `createCombat`) en un enrutador que evalúa los cambios y emite al servidor únicamente los "Deltas" relevantes para no saturar la red.
* **UI Segregada y Plantillas (Handlebars):** Separación total de la lógica de interfaz respecto al diseño. Los estilos emplean variables CSS centralizadas, y el marcado HTML se compila dinámicamente mediante el motor de plantillas `.hbs` nativo de Foundry.