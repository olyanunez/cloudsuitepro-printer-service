const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const log = require('electron-log');
const server = require('../server');

let tray = null;
let settingsWindow = null;

// Configurar logs
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Prevenir que la app se cierre al cerrar todas las ventanas
app.on('window-all-closed', (e) => {
    e.preventDefault();
});

app.whenReady().then(() => {
    log.info('CloudSuite Printer Service iniciando...');

    // Iniciar servidor HTTP
    try {
        server.start(9100);
        log.info('Servidor HTTP iniciado en puerto 9100');
    } catch (error) {
        log.error('Error al iniciar servidor:', error);
    }

    // Crear tray icon
    createTray();

    // Auto-inicio con el sistema
    if (!app.isPackaged) {
        log.info('Modo desarrollo - auto-inicio deshabilitado');
    } else {
        app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: true,
            args: ['--hidden']
        });
        log.info('Auto-inicio configurado');
    }
});

function createTray() {
    // Crear icono del tray
    const icon = nativeImage.createFromPath(
        path.join(__dirname, '../assets/icon.png')
    );

    tray = new Tray(icon.resize({ width: 16, height: 16 }));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'CloudSuite Printer Service v1.0.0',
            enabled: false,
            icon: icon.resize({ width: 16, height: 16 })
        },
        { type: 'separator' },
        {
            label: '✓ Servicio activo en puerto 9100',
            enabled: false
        },
        { type: 'separator' },
        {
            label: 'Configuración',
            click: openSettings
        },
        {
            label: 'Ver logs',
            click: () => {
                const logPath = log.transports.file.getFile().path;
                require('electron').shell.showItemInFolder(logPath);
            }
        },
        { type: 'separator' },
        {
            label: 'Salir',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip('CloudSuite Printer Service - Activo');

    tray.on('click', () => {
        tray.popUpContextMenu();
    });

    log.info('Tray icon creado');
}

function openSettings() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 600,
        height: 500,
        title: 'Configuración - CloudSuite Printer Service',
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, '../assets/icon.png')
    });

    settingsWindow.loadFile(path.join(__dirname, '../assets/settings.html'));

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });

    log.info('Ventana de configuración abierta');
}

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    log.error('Unhandled Rejection:', error);
});
