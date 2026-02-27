/**
 * UI translations — EN/ES
 * Only UI labels, buttons, headers. Product names stay in English.
 */

const translations = {
  en: {
    // Page title
    warehouseOrders: 'Warehouse Orders',

    // Tabs
    orderEntry: 'Order Entry',
    orderQueue: 'Order Queue',
    driverHistory: 'Driver History',
    admin: 'Admin',

    // Controls
    route: 'Route',
    date: 'Date',
    driver: 'Driver',
    selectRoute: 'Select route...',
    selectDriver: 'Select driver...',
    copyLastOrder: 'Copy Last Order',
    clear: 'Clear',
    saveOrder: 'Save Order',
    updateOrder: 'Update Order',
    saving: 'Saving...',
    editingExisting: 'Editing existing order',

    // Warehouse vs Driver panel
    warehouse: 'Warehouse',
    driverHandheld: 'Driver (Handheld)',
    routeCode: 'Route Code',
    invoiceNum: 'Invoice #',
    loadNum: 'Load #',
    cases: 'Cases',
    amount: 'Amount',
    match: 'Match',
    mismatch: 'Mismatch',
    vs: 'vs',

    // Grid columns
    idx: '#',
    sku: 'SKU',
    product: 'Product',
    type: 'Type',
    uic: 'UIC',
    cost: 'Cost',
    orderUnits: 'Order Units',
    total: 'Total $',
    totals: 'TOTALS',

    // Search
    searchProducts: 'Search products...',

    // Summary
    gross: 'gross',

    // Google Sheets
    googleSheets: 'Google Sheets',
    pushToSheet: 'Push to Sheet',
    pullFromSheet: 'Pull from Sheet',
    syncing: 'Syncing...',
    tab: 'Tab',
    sheets: 'Sheets',
    setup: 'Setup',

    // Settings
    sheetsApiConnection: 'Google Sheets API Connection',
    settingsDesc: 'Enter your Google Cloud OAuth Client ID and the Spreadsheet ID from your warehouse order sheet URL.',
    oauthClientId: 'OAuth Client ID',
    spreadsheetId: 'Spreadsheet ID',
    saveConfig: 'Save Config',
    signIn: 'Sign In with Google',
    signOut: 'Sign Out',
    signedInReady: 'Signed in — ready to sync',
    configSavedSignIn: 'Config saved — click Sign In to connect',

    // Pull modal
    pullFromGoogleSheet: 'Pull from Google Sheet',
    selectTabToImport: 'Select a sheet tab to import case counts from:',
    loadingTabs: 'Loading tabs...',
    noTabsFound: 'No tabs found. Open browser console (F12) for details.',

    // Conflict modal
    pushConflict: 'Push to Sheet — Data Conflict',
    pullConflict: 'Pull from Sheet — Data Conflict',
    appForm: 'App (Form)',
    googleSheet: 'Google Sheet',
    cancel: 'Cancel',
    mergeSkipExisting: 'Merge (skip existing)',
    overwriteSheet: 'Overwrite Sheet',
    overwriteForm: 'Overwrite Form',

    // Queue
    name: 'Name',
    items: 'Items',
    grossDollar: 'Gross $',
    whInv: 'WH Inv',
    driverLoad: 'Driver Load',
    verify: 'Verify',
    status: 'Status',
    edit: 'Edit',
    delete: 'Delete',
    noOrdersYet: 'No orders yet. Switch to Order Entry to create one.',
    uploaded: 'Uploaded',
    notUploaded: 'Not uploaded',

    // History
    orderHistory: 'Order History',
    settlement: 'Settlement',

    // Stats
    stats: 'Stats',
    overview: 'Overview',
    topProducts: 'Top Products',
    routeBreakdown: 'Route Breakdown',
    categoryMix: 'Category Mix',
    routeFavorites: 'Route Favorites',
    orderFrequency: 'Order Frequency',
    totalOrders: 'Total Orders',
    totalCases: 'Total Cases',
    totalCost: 'Total Cost',
    totalRevenue: 'Total Revenue',
    grossProfit: 'Gross Profit',
    avgOrderSize: 'Avg Order Size',
    rank: 'Rank',
    numOrders: '# Orders',
    avgCases: 'Avg Cases',
    lastOrder: 'Last Order',
    pctOfTotal: '% of Total',
    margin: 'Margin',
    top5Products: 'Top 5 Products',
    avgDaysBetween: 'Avg Days Between',
    daysSinceLast: 'Days Since Last',
    allTime: 'All Time',
    last7Days: 'Last 7 Days',
    last30Days: 'Last 30 Days',
    last90Days: 'Last 90 Days',
    dateRange: 'Date Range',
    noStatsData: 'No order data yet. Create orders to see statistics.',
    showAll: 'Show All',
    showLess: 'Show Less',
    casesPerOrder: 'cases/order',
    revenue: 'Revenue',
  },

  es: {
    // Page title
    warehouseOrders: 'Ordenes de Almacen',

    // Tabs
    orderEntry: 'Entrada de Orden',
    orderQueue: 'Cola de Ordenes',
    driverHistory: 'Historial de Chofer',
    admin: 'Admin',

    // Controls
    route: 'Ruta',
    date: 'Fecha',
    driver: 'Chofer',
    selectRoute: 'Seleccionar ruta...',
    selectDriver: 'Seleccionar chofer...',
    copyLastOrder: 'Copiar Ultima Orden',
    clear: 'Limpiar',
    saveOrder: 'Guardar Orden',
    updateOrder: 'Actualizar Orden',
    saving: 'Guardando...',
    editingExisting: 'Editando orden existente',

    // Warehouse vs Driver panel
    warehouse: 'Almacen',
    driverHandheld: 'Chofer (Portatil)',
    routeCode: 'Codigo de Ruta',
    invoiceNum: 'Factura #',
    loadNum: 'Carga #',
    cases: 'Cajas',
    amount: 'Monto',
    match: 'Coincide',
    mismatch: 'No Coincide',
    vs: 'vs',

    // Grid columns
    idx: '#',
    sku: 'SKU',
    product: 'Producto',
    type: 'Tipo',
    uic: 'UIC',
    cost: 'Costo',
    orderUnits: 'Unidades',
    total: 'Total $',
    totals: 'TOTALES',

    // Search
    searchProducts: 'Buscar productos...',

    // Summary
    gross: 'bruto',

    // Google Sheets
    googleSheets: 'Google Sheets',
    pushToSheet: 'Enviar a Hoja',
    pullFromSheet: 'Traer de Hoja',
    syncing: 'Sincronizando...',
    tab: 'Pestana',
    sheets: 'Hojas',
    setup: 'Config',

    // Settings
    sheetsApiConnection: 'Conexion API Google Sheets',
    settingsDesc: 'Ingrese su OAuth Client ID de Google Cloud y el ID de la hoja de calculo.',
    oauthClientId: 'OAuth Client ID',
    spreadsheetId: 'ID de Hoja',
    saveConfig: 'Guardar Config',
    signIn: 'Iniciar Sesion con Google',
    signOut: 'Cerrar Sesion',
    signedInReady: 'Conectado — listo para sincronizar',
    configSavedSignIn: 'Config guardada — presione Iniciar Sesion',

    // Pull modal
    pullFromGoogleSheet: 'Traer de Google Sheet',
    selectTabToImport: 'Seleccione una pestana para importar cajas:',
    loadingTabs: 'Cargando pestanas...',
    noTabsFound: 'No se encontraron pestanas.',

    // Conflict modal
    pushConflict: 'Enviar a Hoja — Conflicto',
    pullConflict: 'Traer de Hoja — Conflicto',
    appForm: 'App (Forma)',
    googleSheet: 'Google Sheet',
    cancel: 'Cancelar',
    mergeSkipExisting: 'Combinar (saltar existentes)',
    overwriteSheet: 'Sobrescribir Hoja',
    overwriteForm: 'Sobrescribir Forma',

    // Queue
    name: 'Nombre',
    items: 'Articulos',
    grossDollar: 'Bruto $',
    whInv: 'Factura Alm.',
    driverLoad: 'Carga Chofer',
    verify: 'Verificar',
    status: 'Estado',
    edit: 'Editar',
    delete: 'Borrar',
    noOrdersYet: 'No hay ordenes. Cambie a Entrada de Orden para crear una.',
    uploaded: 'Subido',
    notUploaded: 'No subido',

    // History
    orderHistory: 'Historial de Ordenes',
    settlement: 'Liquidacion',

    // Stats
    stats: 'Estadisticas',
    overview: 'Resumen',
    topProducts: 'Productos Principales',
    routeBreakdown: 'Desglose por Ruta',
    categoryMix: 'Mezcla de Categorias',
    routeFavorites: 'Favoritos por Ruta',
    orderFrequency: 'Frecuencia de Ordenes',
    totalOrders: 'Total de Ordenes',
    totalCases: 'Total de Cajas',
    totalCost: 'Costo Total',
    totalRevenue: 'Ingresos Totales',
    grossProfit: 'Ganancia Bruta',
    avgOrderSize: 'Tamano Promedio',
    rank: 'Rango',
    numOrders: '# Ordenes',
    avgCases: 'Cajas Prom.',
    lastOrder: 'Ultima Orden',
    pctOfTotal: '% del Total',
    margin: 'Margen',
    top5Products: 'Top 5 Productos',
    avgDaysBetween: 'Dias Prom. Entre',
    daysSinceLast: 'Dias Desde Ultima',
    allTime: 'Todo el Tiempo',
    last7Days: 'Ultimos 7 Dias',
    last30Days: 'Ultimos 30 Dias',
    last90Days: 'Ultimos 90 Dias',
    dateRange: 'Rango de Fechas',
    noStatsData: 'No hay datos de ordenes. Cree ordenes para ver estadisticas.',
    showAll: 'Ver Todo',
    showLess: 'Ver Menos',
    casesPerOrder: 'cajas/orden',
    revenue: 'Ingresos',
  },
};

/** Get translated string */
export function t(lang, key) {
  return translations[lang]?.[key] || translations.en[key] || key;
}

export default translations;
