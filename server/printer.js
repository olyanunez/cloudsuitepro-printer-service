const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const log = require('electron-log');
const fs = require('fs');
const path = require('path');

class PrinterService {
    constructor() {
        this.configPath = path.join(__dirname, '../config/settings.json');
        this.loadConfig();
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                log.info('Configuración cargada:', this.config);
            } else {
                this.config = {
                    printerName: null,
                    printerType: 'EPSON',
                    interface: 'printer',
                    width: 48,
                    characterSet: 'PC437_USA'
                };
                this.saveConfig();
            }
        } catch (error) {
            log.error('Error cargando configuración:', error);
            this.config = {
                printerName: null,
                printerType: 'EPSON',
                interface: 'printer',
                width: 48,
                characterSet: 'PC437_USA'
            };
        }
    }

    saveConfig() {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
            log.info('Configuración guardada');
        } catch (error) {
            log.error('Error guardando configuración:', error);
        }
    }

    getConfig() {
        return this.config;
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.saveConfig();
    }

    createPrinter() {
        const printer = new ThermalPrinter({
            type: PrinterTypes[this.config.printerType] || PrinterTypes.EPSON,
            interface: this.config.interface,
            width: this.config.width,
            characterSet: this.config.characterSet,
            options: {
                timeout: 5000
            }
        });

        if (this.config.printerName) {
            printer.setPrinter(this.config.printerName);
        }

        return printer;
    }

    async listPrinters() {
        try {
            const printer = this.createPrinter();
            const printers = printer.printerName ? [printer.printerName] : [];

            // En macOS, intentar obtener la lista de impresoras del sistema
            if (process.platform === 'darwin') {
                const { execSync } = require('child_process');
                try {
                    const output = execSync('lpstat -p -d', { encoding: 'utf8' });
                    const lines = output.split('\n');
                    const printerNames = lines
                        .filter(line => line.startsWith('printer'))
                        .map(line => line.split(' ')[1]);
                    return printerNames.length > 0 ? printerNames : printers;
                } catch (err) {
                    log.warn('No se pudo obtener lista de impresoras del sistema');
                }
            }

            return printers;
        } catch (error) {
            log.error('Error listando impresoras:', error);
            throw error;
        }
    }

    async printInvoice(data) {
        // Modo simulación: Si no hay impresora configurada, solo mostrar en log
        if (!this.config.printerName) {
            log.info('═══════════════════════════════════════════════');
            log.info('🖨️  MODO SIMULACIÓN - Sin impresora configurada');
            log.info('═══════════════════════════════════════════════');
            log.info('');
            log.info(`          ${data.companyName || 'CloudSuite Pro'}`);
            if (data.companyAddress) log.info(`          ${data.companyAddress}`);
            if (data.companyRnc) log.info(`          RNC: ${data.companyRnc}`);
            if (data.companyPhone) log.info(`          Tel: ${data.companyPhone}`);
            log.info('───────────────────────────────────────────────');
            if (data.ncf) log.info(`NCF: ${data.ncf}`);
            log.info(`FACTURA: ${data.invoiceNumber || 'N/A'}`);
            log.info(`Fecha: ${this.formatDate(data.date)}`);
            log.info(`Cliente: ${data.customerName || 'Consumidor Final'}`);
            if (data.customerRnc) log.info(`RNC/Cedula: ${data.customerRnc}`);
            log.info('───────────────────────────────────────────────');
            log.info('Cant  Descripcion              Total');
            log.info('───────────────────────────────────────────────');

            for (const item of data.items || []) {
                const qty = (item.quantity?.toString() || '1').padEnd(5);
                const name = this.truncate(item.name || item.description || '', 20).padEnd(23);
                const total = `$${this.formatMoney(item.total || item.price)}`;
                log.info(`${qty} ${name} ${total}`);
                if (item.quantity > 1 && item.price) {
                    log.info(`      @ $${this.formatMoney(item.price)} c/u`);
                }
            }

            log.info('───────────────────────────────────────────────');
            if (data.subtotal !== undefined) {
                log.info(`                  Subtotal: $${this.formatMoney(data.subtotal)}`);
            }
            if (data.discount && data.discount > 0) {
                log.info(`                 Descuento: -$${this.formatMoney(data.discount)}`);
            }
            if (data.tax !== undefined) {
                log.info(`             ITBIS (18%): $${this.formatMoney(data.tax)}`);
            }
            log.info('═══════════════════════════════════════════════');
            log.info(`              TOTAL: $${this.formatMoney(data.total)}`);
            log.info('═══════════════════════════════════════════════');
            if (data.paymentMethod) {
                log.info(`Metodo de pago: ${data.paymentMethod}`);
            }
            log.info('');
            log.info('          ¡Gracias por su compra!');
            if (data.footer) log.info(`          ${data.footer}`);
            log.info('');
            log.info('✅ Factura simulada exitosamente');
            log.info('');
            return;
        }

        // Modo real: Imprimir en impresora térmica
        const printer = this.createPrinter();

        try {
            // Header
            printer.alignCenter();
            printer.setTextSize(1, 1);
            printer.bold(true);
            printer.println(data.companyName || 'CloudSuite Pro');
            printer.bold(false);
            printer.setTextSize(0, 0);

            if (data.companyAddress) printer.println(data.companyAddress);
            if (data.companyRnc) printer.println(`RNC: ${data.companyRnc}`);
            if (data.companyPhone) printer.println(`Tel: ${data.companyPhone}`);

            printer.drawLine();

            // Info factura
            printer.alignLeft();
            printer.bold(true);

            if (data.ncf) {
                printer.println(`NCF: ${data.ncf}`);
            }
            printer.println(`FACTURA: ${data.invoiceNumber || 'N/A'}`);
            printer.bold(false);

            printer.println(`Fecha: ${this.formatDate(data.date)}`);
            printer.println(`Cliente: ${data.customerName || 'Consumidor Final'}`);

            if (data.customerRnc) {
                printer.println(`RNC/Cedula: ${data.customerRnc}`);
            }

            printer.drawLine();

            // Tabla de items
            printer.tableCustom([
                { text: 'Cant', align: 'LEFT', width: 0.1 },
                { text: 'Descripcion', align: 'LEFT', width: 0.5 },
                { text: 'Total', align: 'RIGHT', width: 0.39 }
            ]);
            printer.drawLine();

            // Items
            for (const item of data.items || []) {
                printer.tableCustom([
                    { text: item.quantity?.toString() || '1', align: 'LEFT', width: 0.1 },
                    { text: this.truncate(item.name || item.description || '', 24), align: 'LEFT', width: 0.5 },
                    { text: `$${this.formatMoney(item.total || item.price)}`, align: 'RIGHT', width: 0.39 }
                ]);

                // Precio unitario si es diferente
                if (item.quantity > 1 && item.price) {
                    printer.println(`  @ $${this.formatMoney(item.price)} c/u`);
                }
            }

            printer.drawLine();

            // Totales
            printer.alignRight();

            if (data.subtotal !== undefined) {
                printer.println(`Subtotal: $${this.formatMoney(data.subtotal)}`);
            }

            if (data.discount && data.discount > 0) {
                printer.println(`Descuento: -$${this.formatMoney(data.discount)}`);
            }

            if (data.tax !== undefined) {
                printer.println(`ITBIS (18%): $${this.formatMoney(data.tax)}`);
            }

            printer.drawLine();
            printer.bold(true);
            printer.setTextSize(1, 1);
            printer.println(`TOTAL: $${this.formatMoney(data.total)}`);
            printer.bold(false);
            printer.setTextSize(0, 0);

            // Método de pago
            if (data.paymentMethod) {
                printer.newLine();
                printer.println(`Metodo de pago: ${data.paymentMethod}`);
            }

            // Footer
            printer.alignCenter();
            printer.newLine();
            printer.println('Gracias por su compra!');

            if (data.footer) {
                printer.println(data.footer);
            }

            printer.newLine();
            printer.cut();

            await printer.execute();
            log.info('Factura impresa exitosamente');
        } catch (error) {
            log.error('Error imprimiendo factura:', error);
            throw error;
        }
    }

    async printTicket(data) {
        const printer = this.createPrinter();

        try {
            printer.alignCenter();
            printer.setTextSize(1, 1);
            printer.bold(true);
            printer.println(data.title || 'TICKET');
            printer.bold(false);
            printer.setTextSize(0, 0);
            printer.println(this.formatDate(new Date()));
            printer.drawLine();

            printer.alignLeft();
            if (data.content) {
                printer.println(data.content);
            }

            printer.newLine();
            printer.alignCenter();
            printer.cut();

            await printer.execute();
            log.info('Ticket impreso exitosamente');
        } catch (error) {
            log.error('Error imprimiendo ticket:', error);
            throw error;
        }
    }

    async printReport(data) {
        const printer = this.createPrinter();

        try {
            // Header
            printer.alignCenter();
            printer.bold(true);
            printer.println(data.title || 'REPORTE');
            printer.bold(false);
            printer.println(this.formatDate(new Date()));
            printer.drawLine();

            // Content
            printer.alignLeft();
            if (data.lines && Array.isArray(data.lines)) {
                for (const line of data.lines) {
                    if (line.type === 'line') {
                        printer.drawLine();
                    } else if (line.type === 'title') {
                        printer.bold(true);
                        printer.println(line.text || '');
                        printer.bold(false);
                    } else {
                        printer.println(line.text || '');
                    }
                }
            }

            printer.newLine();
            printer.cut();

            await printer.execute();
            log.info('Reporte impreso exitosamente');
        } catch (error) {
            log.error('Error imprimiendo reporte:', error);
            throw error;
        }
    }

    async openCashDrawer() {
        const printer = this.createPrinter();

        try {
            printer.openCashDrawer();
            await printer.execute();
            log.info('Cajón abierto');
        } catch (error) {
            log.error('Error abriendo cajón:', error);
            throw error;
        }
    }

    async testPrint() {
        const printer = this.createPrinter();

        try {
            printer.alignCenter();
            printer.bold(true);
            printer.println('TEST DE IMPRESION');
            printer.bold(false);
            printer.println('CloudSuite Printer Service');
            printer.println(this.formatDate(new Date()));
            printer.drawLine();
            printer.println('Si puede leer esto,');
            printer.println('la impresora funciona correctamente!');
            printer.newLine();
            printer.cut();

            await printer.execute();
            log.info('Test de impresión ejecutado');
        } catch (error) {
            log.error('Error en test de impresión:', error);
            throw error;
        }
    }

    // Utilidades
    formatDate(date) {
        const d = new Date(date);
        return d.toLocaleString('es-DO', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatMoney(amount) {
        return parseFloat(amount || 0).toFixed(2);
    }

    truncate(str, length) {
        if (!str) return '';
        return str.length > length ? str.substring(0, length - 3) + '...' : str;
    }
}

module.exports = PrinterService;
