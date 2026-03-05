const express = require('express');
const cors = require('cors');
const log = require('electron-log');
const PrinterService = require('./printer');

class PrintServer {
    constructor() {
        this.app = express();
        this.printerService = new PrinterService();
        this.server = null;
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            allowedHeaders: ['Content-Type']
        }));
        this.app.use(express.json({ limit: '10mb' }));

        // Logger middleware
        this.app.use((req, res, next) => {
            log.info(`${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                version: '1.0.0',
                service: 'CloudSuite Printer Service'
            });
        });

        // Listar impresoras disponibles
        this.app.get('/printers', async (req, res) => {
            try {
                const printers = await this.printerService.listPrinters();
                res.json({ success: true, printers });
            } catch (error) {
                log.error('Error listando impresoras:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Obtener configuración actual
        this.app.get('/config', (req, res) => {
            const config = this.printerService.getConfig();
            res.json({ success: true, config });
        });

        // Actualizar configuración
        this.app.post('/config', (req, res) => {
            try {
                this.printerService.updateConfig(req.body);
                res.json({ success: true, message: 'Configuración actualizada' });
            } catch (error) {
                log.error('Error actualizando configuración:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Imprimir factura
        this.app.post('/print/invoice', async (req, res) => {
            try {
                log.info('Imprimiendo factura:', req.body.invoiceNumber || 'N/A');
                await this.printerService.printInvoice(req.body);
                res.json({ success: true, message: 'Factura impresa correctamente' });
            } catch (error) {
                log.error('Error imprimiendo factura:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Imprimir ticket
        this.app.post('/print/ticket', async (req, res) => {
            try {
                log.info('Imprimiendo ticket');
                await this.printerService.printTicket(req.body);
                res.json({ success: true, message: 'Ticket impreso correctamente' });
            } catch (error) {
                log.error('Error imprimiendo ticket:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Imprimir reporte
        this.app.post('/print/report', async (req, res) => {
            try {
                log.info('Imprimiendo reporte:', req.body.type || 'N/A');
                await this.printerService.printReport(req.body);
                res.json({ success: true, message: 'Reporte impreso correctamente' });
            } catch (error) {
                log.error('Error imprimiendo reporte:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Abrir cajón de dinero
        this.app.post('/open-drawer', async (req, res) => {
            try {
                log.info('Abriendo cajón de dinero');
                await this.printerService.openCashDrawer();
                res.json({ success: true, message: 'Cajón abierto' });
            } catch (error) {
                log.error('Error abriendo cajón:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Test de impresión
        this.app.post('/test', async (req, res) => {
            try {
                log.info('Ejecutando test de impresión');
                await this.printerService.testPrint();
                res.json({ success: true, message: 'Test de impresión enviado' });
            } catch (error) {
                log.error('Error en test de impresión:', error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Manejo de errores 404
        this.app.use((req, res) => {
            res.status(404).json({
                success: false,
                error: 'Endpoint no encontrado'
            });
        });
    }

    start(port) {
        this.server = this.app.listen(port, '127.0.0.1', () => {
            log.info(`✓ Printer Service activo en http://localhost:${port}`);
        });

        this.server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                log.error(`Puerto ${port} ya está en uso`);
            } else {
                log.error('Error en servidor:', error);
            }
        });
    }

    stop() {
        if (this.server) {
            this.server.close(() => {
                log.info('Servidor detenido');
            });
        }
    }
}

module.exports = new PrintServer();
