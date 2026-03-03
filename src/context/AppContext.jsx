import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { sampleStores, sampleZones, processStoresFromCsv, storesToCsv } from '../data/sampleData';
import { fleetVehicles } from '../data/fleetData';
import { fetchStoresCsv, saveStoresCsv, fetchAlertsCsv, saveAlertsCsv, fetchSchedulesJson, saveSchedulesJson, fetchImportLog, saveImportLog, fetchVisitHistoryJson, saveVisitHistoryJson, fetchWarehousesJson, saveWarehousesJson, fetchTravelLogJson, saveTravelLogJson, fetchAddressOverridesJson, saveAddressOverridesJson, fetchCustomLocationsJson, saveCustomLocationsJson, fetchTransactionsJson, saveTransactionsJson, fetchWarehouseOrdersJson, saveWarehouseOrdersJson, fetchInventoryJson, saveInventoryJson, getToken } from '../services/githubService';
import { loadLocalData, saveLocalData } from '../services/localDataService';
import { parseAlertsCsv, alertsToCsv, matchAlertToStore, fetchAlertEmails, isGmailConnected, fetchAlertImage as fetchAlertImageApi, labelAlertMessages, labelAlertsDone, labelAlertsProcessed, labelAlertsCompleted, labelAlertsError, unlabelAlertsDoneAndCompleted } from '../services/gmailAlertService';
import { acceptAlerts as gwAcceptAlerts, completeAlerts as gwCompleteAlerts } from '../services/globalworxService';
import localSchedules from '../data/schedules.json';
import localVisitHistory from '../data/visitHistory.json';
import localWarehouses from '../data/warehouses.json';
import localTravelLog from '../data/travelLog.json';
import localAddressOverrides from '../data/addressOverrides.json';
import localCustomLocations from '../data/customLocations.json';
import localTransactions from '../data/transactions.json';
import localWarehouseOrders from '../data/warehouseOrders.json';
import localInventoryData from '../data/inventoryData.json';

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const AppContext = createContext();

const initialState = {
  stores: sampleStores,
  zones: sampleZones,
  selectedStore: null,
  selectedZone: null,
  selectedSubZone: null,
  sidebarTab: 'stores',
  searchTerm: '',
  filterRegion: 'all',
  filterType: 'all',
  filterRoute: 'all',
  mapCenter: [39.0, -76.8],
  mapZoom: 8,
  currentPage: 'map',
  syncStatus: 'idle', // idle | loading | saving | saved | error
  syncError: null,
  alerts: [],
  alertSyncStatus: 'idle', // idle | loading | saving | saved | error
  alertSyncError: null,
  alertImages: {}, // { emailId: { dataUri, filename, loading, error } } — memory-only
  importLog: [], // Array of import entries, newest first
  schedules: localSchedules, // { "route_weekOf": { monday: [...], ... } }
  visitHistory: localVisitHistory, // { storeId: ['YYYY-MM-DD', ...] }
  // Fleet tracking (Motive API)
  fleetVehicles: fleetVehicles,
  vehicleLocations: [],
  fleetSyncStatus: 'idle', // idle | loading | error | connected
  fleetSyncError: null,
  showVehiclesOnMap: false,
  // Proximity auto-visit & travel log
  warehouses: localWarehouses, // [{ id, name, address, lat, lng }]
  travelLog: localTravelLog,  // { "YYYY-MM-DD": { "vehicleVin": [{ time, type, locationId, locationName }] } }
  addressOverrides: localAddressOverrides, // { "destination address": "storeId" }
  customLocations: localCustomLocations, // [{ id, name, type, address, lat, lng }]
  transactions: localTransactions, // Raw DAO dashboard transaction data
  warehouseOrders: (() => {
    try {
      const saved = localStorage.getItem('warehouseOrders');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.orders) return parsed;
      }
    } catch { /* ignore */ }
    return localWarehouseOrders;
  })(), // { orders: [], lastSyncedAt: null }
  inventory: (() => {
    try {
      const saved = localStorage.getItem('inventoryData');
      if (saved) { const parsed = JSON.parse(saved); if (parsed && parsed.items) return parsed; }
    } catch { /* ignore */ }
    return localInventoryData;
  })(), // { items: { sku: { incoming, sold, caseCount, ... } }, lastUpdated }
  autoVisitEnabled: true,
  language: localStorage.getItem('app_language') || 'en',
};

const easternShoreSubsections = {
  'Chestertown': 'Upper Shore',
  'Centerville': 'Upper Shore',
  'Millington': 'Upper Shore',
  'Stevensville': 'Upper Shore',
  'Denton': 'Upper Shore',
  'Easton': 'Mid Shore',
  'Cambridge': 'Mid Shore',
  'Federalsburg': 'Mid Shore',
  'MD': 'Mid Shore',
  'Salisbury': 'Lower Shore',
  'SALISBURY': 'Lower Shore',
  'Fruitland': 'Lower Shore',
  'Princess Anne': 'Lower Shore',
  'Crisfield': 'Lower Shore',
  'Ocean City': 'Ocean City & Coastal',
  'Berlin': 'Ocean City & Coastal',
  'BERLIN': 'Ocean City & Coastal',
  'Dover': 'Dover Area',
};

function reassignStores(stores, zones) {
  return stores.map((store) => {
    const zone = zones.find((z) => z.name === store.region);
    if (zone) {
      let subZone;
      if (store.region === 'Eastern Shore Maryland') {
        const subsection = easternShoreSubsections[store.territory] || 'Lower Shore';
        subZone = zone.subZones.find((sz) => sz.name === subsection);
      } else {
        subZone = zone.subZones.find((sz) => sz.name === store.territory);
      }
      return {
        ...store,
        zoneId: zone.id,
        subZoneId: subZone ? subZone.id : null,
      };
    }
    return { ...store, zoneId: null, subZoneId: null };
  });
}

function reducer(state, action) {
  switch (action.type) {
    case 'LOAD_FROM_GITHUB': {
      const { stores, zones } = action.payload;
      return { ...state, stores, zones, syncStatus: 'saved', syncError: null };
    }
    case 'SET_SYNC_STATUS':
      return { ...state, syncStatus: action.payload.status, syncError: action.payload.error || null };
    case 'ADD_STORE': {
      const newStore = { id: uuidv4(), ...action.payload };
      const updatedStores = [...state.stores, newStore];
      return { ...state, stores: reassignStores(updatedStores, state.zones), syncStatus: 'idle' };
    }
    case 'UPDATE_STORE': {
      const updatedStores = state.stores.map((s) =>
        s.id === action.payload.id ? { ...s, ...action.payload } : s
      );
      return { ...state, stores: reassignStores(updatedStores, state.zones), syncStatus: 'idle' };
    }
    case 'BULK_IMPORT_STORES': {
      const { updates, additions } = action.payload;
      let updatedStores = [...state.stores];
      // Apply updates to existing stores (strip display-only fields)
      const updateMap = {};
      updates.forEach(u => {
        const { _displayName, ...clean } = u;
        updateMap[clean.id] = clean;
      });
      updatedStores = updatedStores.map(s =>
        updateMap[s.id] ? { ...s, ...updateMap[s.id] } : s
      );
      // Add new stores
      additions.forEach(a => { updatedStores.push(a); });
      return { ...state, stores: reassignStores(updatedStores, state.zones), syncStatus: 'idle' };
    }
    case 'DELETE_STORE':
      return {
        ...state,
        stores: state.stores.filter((s) => s.id !== action.payload),
        selectedStore:
          state.selectedStore === action.payload ? null : state.selectedStore,
        syncStatus: 'idle',
      };
    case 'ADD_ZONE': {
      const newZone = { id: uuidv4(), subZones: [], ...action.payload };
      const newZones = [...state.zones, newZone];
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
      };
    }
    case 'UPDATE_ZONE': {
      const newZones = state.zones.map((z) =>
        z.id === action.payload.id ? { ...z, ...action.payload } : z
      );
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
      };
    }
    case 'DELETE_ZONE': {
      const newZones = state.zones.filter((z) => z.id !== action.payload);
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
        selectedZone:
          state.selectedZone === action.payload ? null : state.selectedZone,
      };
    }
    case 'ADD_SUBZONE': {
      const { zoneId, subZone } = action.payload;
      const newSubZone = { id: uuidv4(), ...subZone };
      const newZones = state.zones.map((z) =>
        z.id === zoneId
          ? { ...z, subZones: [...z.subZones, newSubZone] }
          : z
      );
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
      };
    }
    case 'UPDATE_SUBZONE': {
      const { zoneId, subZone } = action.payload;
      const newZones = state.zones.map((z) =>
        z.id === zoneId
          ? {
              ...z,
              subZones: z.subZones.map((sz) =>
                sz.id === subZone.id ? { ...sz, ...subZone } : sz
              ),
            }
          : z
      );
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
      };
    }
    case 'DELETE_SUBZONE': {
      const { zoneId, subZoneId } = action.payload;
      const newZones = state.zones.map((z) =>
        z.id === zoneId
          ? { ...z, subZones: z.subZones.filter((sz) => sz.id !== subZoneId) }
          : z
      );
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
        selectedSubZone:
          state.selectedSubZone === subZoneId ? null : state.selectedSubZone,
      };
    }
    case 'SELECT_STORE':
      return { ...state, selectedStore: action.payload };
    case 'SELECT_ZONE':
      return { ...state, selectedZone: action.payload, selectedSubZone: null };
    case 'SELECT_SUBZONE':
      return { ...state, selectedSubZone: action.payload };
    case 'SET_SIDEBAR_TAB':
      return { ...state, sidebarTab: action.payload };
    case 'SET_SEARCH':
      return { ...state, searchTerm: action.payload };
    case 'SET_FILTER_REGION':
      return { ...state, filterRegion: action.payload };
    case 'SET_FILTER_TYPE':
      return { ...state, filterType: action.payload };
    case 'SET_FILTER_ROUTE':
      return { ...state, filterRoute: action.payload };
    case 'SET_MAP_VIEW':
      return {
        ...state,
        mapCenter: action.payload.center,
        mapZoom: action.payload.zoom,
      };
    case 'SET_PAGE':
      return { ...state, currentPage: action.payload };
    case 'LOAD_ALERTS':
      return { ...state, alerts: action.payload, alertSyncStatus: 'saved', alertSyncError: null };
    case 'SET_ALERTS':
      return { ...state, alerts: action.payload, alertSyncStatus: 'idle' };
    case 'SET_ALERT_SYNC_STATUS':
      return { ...state, alertSyncStatus: action.payload.status, alertSyncError: action.payload.error || null };
    case 'SET_ALERT_IMAGE': {
      const { emailId, ...imageData } = action.payload;
      return { ...state, alertImages: { ...state.alertImages, [emailId]: imageData } };
    }
    case 'LOAD_IMPORT_LOG':
      return { ...state, importLog: action.payload };
    case 'ADD_IMPORT_ENTRY':
      return { ...state, importLog: [action.payload, ...state.importLog] };
    case 'LOAD_SCHEDULES':
      return { ...state, schedules: action.payload };
    case 'SET_SCHEDULE': {
      const { key, schedule } = action.payload;
      return { ...state, schedules: { ...state.schedules, [key]: schedule } };
    }
    case 'LOAD_VISIT_HISTORY': {
      const loadedVH = action.payload;
      // Reconcile stores' lastVisited with visit history dates
      const reconciledStores = state.stores.map(s => {
        const visits = loadedVH[s.id];
        if (!visits || visits.length === 0) return s;
        const newest = visits[visits.length - 1]; // already sorted
        if (!s.lastVisited || newest > s.lastVisited.split('T')[0]) {
          return { ...s, lastVisited: newest };
        }
        return s;
      });
      return { ...state, visitHistory: loadedVH, stores: reconciledStores };
    }
    case 'RECORD_VISIT': {
      const { storeId, date } = action.payload;
      const existing = state.visitHistory[storeId] || [];
      if (existing.includes(date)) return state;
      const updated = [...existing, date].sort();
      const newest = updated[updated.length - 1];
      return {
        ...state,
        visitHistory: { ...state.visitHistory, [storeId]: updated },
        stores: state.stores.map(s =>
          s.id === storeId ? { ...s, lastVisited: newest } : s
        ),
      };
    }
    case 'BULK_RECORD_VISITS': {
      const entries = action.payload;
      let newVH = { ...state.visitHistory };
      let newStores = state.stores;
      entries.forEach(({ storeId, date }) => {
        const existing = newVH[storeId] || [];
        if (!existing.includes(date)) {
          const updated = [...existing, date].sort();
          newVH = { ...newVH, [storeId]: updated };
          const newest = updated[updated.length - 1];
          newStores = newStores.map(s =>
            s.id === storeId && (!s.lastVisited || newest > s.lastVisited)
              ? { ...s, lastVisited: newest }
              : s
          );
        }
      });
      return { ...state, visitHistory: newVH, stores: newStores };
    }
    case 'SET_VEHICLE_LOCATIONS':
      return {
        ...state,
        vehicleLocations: action.payload,
        fleetSyncStatus: 'connected',
        fleetSyncError: null,
      };
    case 'SET_FLEET_SYNC_STATUS':
      return {
        ...state,
        fleetSyncStatus: action.payload.status,
        fleetSyncError: action.payload.error || null,
      };
    case 'TOGGLE_VEHICLES_ON_MAP':
      return { ...state, showVehiclesOnMap: !state.showVehiclesOnMap };
    case 'SET_VEHICLES_ON_MAP':
      return { ...state, showVehiclesOnMap: action.payload };
    // Warehouses
    case 'LOAD_WAREHOUSES':
      return { ...state, warehouses: action.payload };
    case 'SET_WAREHOUSES':
      return { ...state, warehouses: action.payload };
    // Travel Log
    case 'LOAD_TRAVEL_LOG':
      return { ...state, travelLog: action.payload };
    case 'LOG_TRAVEL_ENTRIES': {
      // action.payload: { entries, date } or [entries] (legacy)
      const raw = action.payload;
      const entries = Array.isArray(raw) ? raw : raw.entries;
      const forceDate = !Array.isArray(raw) && raw.date ? raw.date : null;
      if (entries.length === 0) return state;
      const fallbackDate = localDateStr();
      const newLog = { ...state.travelLog };
      entries.forEach(entry => {
        // Derive date from entry time, or use the forced date, or fallback to today
        const dateKey = forceDate || (entry.time ? entry.time.slice(0, 10) : fallbackDate);
        if (!newLog[dateKey]) newLog[dateKey] = {};
        if (!newLog[dateKey][entry.vehicleVin]) newLog[dateKey][entry.vehicleVin] = [];
        // Dedup: skip if already logged this exact location+time for this vehicle
        // Use locationId + time-to-the-minute so the same place can be visited multiple times per day
        const existing = newLog[dateKey][entry.vehicleVin];
        const entryTimeKey = (entry.time || '').slice(0, 16);
        if (!existing.some(e => e.locationId === entry.locationId && (e.time || '').slice(0, 16) === entryTimeKey)) {
          // Sanitize locationName: repair double-encoded → arrow characters
          const cleanName = (n) => n
            ? n.replace(/\s*[\u00C0-\u00FF\u0080-\u009F]{3,}\s*/g, ' \u2192 ').replace(/\s*\u2192\s*/g, ' \u2192 ').trim()
            : n;
          const record = {
            time: entry.time,
            type: entry.type,
            locationId: entry.locationId,
            locationName: cleanName(entry.locationName),
            lat: entry.lat,
            lng: entry.lng,
            distance: entry.distance,
          };
          if (entry.type === 'driving') {
            record.arrivalTime = entry.arrivalTime;
            record.departureTime = entry.departureTime;
            record.dwellMinutes = entry.dwellMinutes;
            record.driverName = entry.driverName;
            record.destinationLat = entry.destinationLat;
            record.destinationLng = entry.destinationLng;
            record.destination = entry.destination;
          }
          existing.push(record);
        }
      });
      return { ...state, travelLog: newLog };
    }
    case 'MANUAL_MATCH_ENTRIES': {
      // Replace driving entries in-place with matched location entries
      const updates = action.payload; // Array of { vehicleVin, date, oldLocationId, newEntry }
      const newLog = { ...state.travelLog };
      for (const { vehicleVin, date, oldLocationId, newEntry } of updates) {
        if (!newLog[date] || !newLog[date][vehicleVin]) continue;
        newLog[date] = { ...newLog[date] };
        const entries = [...newLog[date][vehicleVin]];
        const idx = entries.findIndex(e => e.locationId === oldLocationId);
        if (idx !== -1) {
          // Replace: keep driving metadata (times, distance, destination) but update location info
          entries[idx] = {
            ...entries[idx],
            type: newEntry.type,
            locationId: newEntry.locationId,
            locationName: newEntry.locationName,
            lat: newEntry.lat,
            lng: newEntry.lng,
          };
          newLog[date][vehicleVin] = entries;
        }
      }
      return { ...state, travelLog: newLog };
    }
    case 'UNMATCH_ENTRY': {
      // Revert a matched entry back to driving / unmatched
      const { vehicleVin: umVin, date: umDate, locationId: umLocId } = action.payload;
      const umLog = { ...state.travelLog };
      if (umLog[umDate] && umLog[umDate][umVin]) {
        umLog[umDate] = { ...umLog[umDate] };
        const umEntries = [...umLog[umDate][umVin]];
        const umIdx = umEntries.findIndex(e => e.locationId === umLocId);
        if (umIdx !== -1) {
          const e = umEntries[umIdx];
          const dest = (e.destination || '').trim();
          umEntries[umIdx] = {
            ...e,
            type: 'driving',
            locationId: `driving-${umDate}-${umVin}-${umIdx}`,
            locationName: dest
              ? `${e.locationName?.split(' → ')[0] || 'Unknown'} → ${dest}`
              : (e.destination || e.locationName),
          };
          umLog[umDate][umVin] = umEntries;
        }
      }
      // Also remove address override that pointed to this location
      const newOverrides = { ...state.addressOverrides };
      let overrideChanged = false;
      Object.keys(newOverrides).forEach(key => {
        if (newOverrides[key] === umLocId) {
          delete newOverrides[key];
          overrideChanged = true;
        }
      });
      return { ...state, travelLog: umLog, ...(overrideChanged ? { addressOverrides: newOverrides } : {}) };
    }
    case 'TOGGLE_AUTO_VISIT':
      return { ...state, autoVisitEnabled: !state.autoVisitEnabled };
    // Address overrides (destination → storeId memory)
    case 'LOAD_ADDRESS_OVERRIDES':
      return { ...state, addressOverrides: action.payload };
    case 'SET_ADDRESS_OVERRIDE': {
      const { destination, storeId } = action.payload;
      return { ...state, addressOverrides: { ...state.addressOverrides, [destination]: storeId } };
    }
    case 'REMOVE_ADDRESS_OVERRIDE': {
      const { destination } = action.payload;
      const next = { ...state.addressOverrides };
      delete next[destination];
      return { ...state, addressOverrides: next };
    }
    // Transactions (DAO dashboard)
    case 'LOAD_TRANSACTIONS':
      return { ...state, transactions: action.payload };
    case 'SET_TRANSACTIONS':
      return { ...state, transactions: action.payload };
    // Warehouse Orders
    case 'LOAD_WAREHOUSE_ORDERS':
      return { ...state, warehouseOrders: action.payload };
    case 'SET_WAREHOUSE_ORDERS':
      return { ...state, warehouseOrders: action.payload };
    case 'ADD_WAREHOUSE_ORDER': {
      const orderPayload = { ...action.payload };
      // Ensure every item has a unique lineId for deduction tracking
      if (orderPayload.items) {
        orderPayload.items = orderPayload.items.map(i => i.lineId ? i : { ...i, lineId: uuidv4() });
      }
      const newOrder = { id: uuidv4(), createdAt: new Date().toISOString(), ...orderPayload };
      return { ...state, warehouseOrders: { ...state.warehouseOrders, orders: [...state.warehouseOrders.orders, newOrder] } };
    }
    case 'UPDATE_WAREHOUSE_ORDER': {
      const updPayload = { ...action.payload };
      // Ensure every item has a unique lineId for deduction tracking
      if (updPayload.items) {
        updPayload.items = updPayload.items.map(i => i.lineId ? i : { ...i, lineId: uuidv4() });
      }
      const updOrders = state.warehouseOrders.orders.map(o => o.id === updPayload.id ? { ...o, ...updPayload, updatedAt: new Date().toISOString() } : o);
      return { ...state, warehouseOrders: { ...state.warehouseOrders, orders: updOrders } };
    }
    case 'DELETE_WAREHOUSE_ORDER':
      return { ...state, warehouseOrders: { ...state.warehouseOrders, orders: state.warehouseOrders.orders.filter(o => o.id !== action.payload) } };
    // Inventory
    case 'LOAD_INVENTORY':
      return { ...state, inventory: action.payload };
    case 'SET_INVENTORY':
      return { ...state, inventory: action.payload };
    case 'DEDUCT_INVENTORY': {
      // payload: { sku, units } — deduct sold units from inventory item
      const { sku, units } = action.payload;
      const existing = state.inventory.items[sku];
      if (!existing) return state;
      const updated = { ...existing, sold: (existing.sold || 0) + units };
      return { ...state, inventory: { ...state.inventory, items: { ...state.inventory.items, [sku]: updated }, lastUpdated: new Date().toISOString().split('T')[0] } };
    }
    // Language
    case 'SET_LANGUAGE':
      localStorage.setItem('app_language', action.payload);
      return { ...state, language: action.payload };
    // Custom locations (gas stations, storage, meeting points, driver homes, etc.)
    case 'LOAD_CUSTOM_LOCATIONS':
      return { ...state, customLocations: action.payload };
    case 'ADD_CUSTOM_LOCATION':
      return { ...state, customLocations: [...state.customLocations, { id: uuidv4(), ...action.payload }] };
    case 'UPDATE_CUSTOM_LOCATION': {
      const updCl = action.payload;
      const newCustomLocations = state.customLocations.map(cl => cl.id === updCl.id ? { ...cl, ...updCl } : cl);
      // Also update locationName/type in travel log entries referencing this custom location
      const newTravelLog = { ...state.travelLog };
      let logChanged = false;
      Object.keys(newTravelLog).forEach(dateKey => {
        const dayLog = newTravelLog[dateKey];
        Object.keys(dayLog).forEach(vin => {
          const entries = dayLog[vin];
          for (let i = 0; i < entries.length; i++) {
            if (entries[i].locationId === updCl.id) {
              if (!logChanged) {
                newTravelLog[dateKey] = { ...dayLog };
                newTravelLog[dateKey][vin] = [...entries];
                logChanged = true;
              } else if (newTravelLog[dateKey] === dayLog) {
                newTravelLog[dateKey] = { ...dayLog };
                newTravelLog[dateKey][vin] = [...entries];
              } else if (newTravelLog[dateKey][vin] === entries) {
                newTravelLog[dateKey][vin] = [...entries];
              }
              newTravelLog[dateKey][vin][i] = {
                ...newTravelLog[dateKey][vin][i],
                locationName: updCl.name || newTravelLog[dateKey][vin][i].locationName,
                type: updCl.type || newTravelLog[dateKey][vin][i].type,
              };
            }
          }
        });
      });
      return { ...state, customLocations: newCustomLocations, travelLog: logChanged ? newTravelLog : state.travelLog };
    }
    case 'DELETE_CUSTOM_LOCATION': {
      const delId = action.payload;
      const filteredCustomLocations = state.customLocations.filter(cl => cl.id !== delId);
      // Revert travel log entries that reference this custom location back to driving
      const delLog = { ...state.travelLog };
      let delLogChanged = false;
      Object.keys(delLog).forEach(dateKey => {
        const dayLog = delLog[dateKey];
        Object.keys(dayLog).forEach(vin => {
          const entries = dayLog[vin];
          for (let i = 0; i < entries.length; i++) {
            if (entries[i].locationId === delId) {
              if (!delLogChanged) {
                delLog[dateKey] = { ...dayLog };
                delLog[dateKey][vin] = [...entries];
                delLogChanged = true;
              } else if (delLog[dateKey] === dayLog) {
                delLog[dateKey] = { ...dayLog };
                delLog[dateKey][vin] = [...entries];
              } else if (delLog[dateKey][vin] === entries) {
                delLog[dateKey][vin] = [...entries];
              }
              const e = delLog[dateKey][vin][i];
              const dest = (e.destination || '').trim();
              delLog[dateKey][vin][i] = {
                ...e,
                type: 'driving',
                locationId: `driving-${dateKey}-${vin}-${i}`,
                locationName: dest
                  ? `${e.locationName?.split(' → ')[0] || 'Unknown'} → ${dest}`
                  : (e.destination || (e.lat && e.lng ? `${e.lat}, ${e.lng}` : e.locationName)),
              };
            }
          }
        });
      });
      // Also remove address overrides that pointed to this custom location
      const delOverrides = { ...state.addressOverrides };
      let delOverrideChanged = false;
      Object.keys(delOverrides).forEach(key => {
        if (delOverrides[key] === delId) {
          delete delOverrides[key];
          delOverrideChanged = true;
        }
      });
      return {
        ...state,
        customLocations: filteredCustomLocations,
        travelLog: delLogChanged ? delLog : state.travelLog,
        ...(delOverrideChanged ? { addressOverrides: delOverrides } : {}),
      };
    }
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const saveTimer = useRef(null);
  const prevStoresRef = useRef(state.stores);

  // Load from GitHub on mount if token is configured
  useEffect(() => {
    if (!getToken()) return;
    dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'loading' } });
    fetchStoresCsv()
      .then(({ content }) => {
        const { stores, zones } = processStoresFromCsv(content);
        // Update ref BEFORE dispatch so auto-save effect sees no change
        prevStoresRef.current = stores;
        dispatch({ type: 'LOAD_FROM_GITHUB', payload: { stores, zones } });
      })
      .catch((err) => {
        console.error('Failed to load from GitHub:', err);
        dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, []);

  // Auto-save to GitHub when stores change (debounced 2s)
  useEffect(() => {
    if (!getToken()) return;
    if (state.syncStatus === 'loading') return;
    // Skip if stores haven't actually changed (initial load, etc.)
    if (prevStoresRef.current === state.stores) return;
    prevStoresRef.current = state.stores;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'saving' } });
      const csv = storesToCsv(state.stores);
      saveStoresCsv(csv)
        .then(() => {
          dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'saved' } });
        })
        .catch((err) => {
          console.error('Failed to save to GitHub:', err);
          dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'error', error: err.message } });
        });
    }, 2000);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state.stores, state.syncStatus]);

  // Manual sync trigger
  const syncFromGithub = useCallback(() => {
    if (!getToken()) return;
    dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'loading' } });
    fetchStoresCsv()
      .then(({ content }) => {
        const { stores, zones } = processStoresFromCsv(content);
        dispatch({ type: 'LOAD_FROM_GITHUB', payload: { stores, zones } });
        // Re-match alerts against fresh store data (fixes wrong matches)
        if (state.alerts.length > 0) {
          reMatchAlerts(state.alerts, stores);
          dispatch({ type: 'SET_ALERTS', payload: [...state.alerts] });
        }
        // After store data refreshes, mark resolved alerts as Done in Gmail
        markResolvedAlertsDone(state.alerts, stores);
        autoCompleteAlerts(state.alerts);
      })
      .catch((err) => {
        dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, [state.alerts]);

  const saveToGithub = useCallback(() => {
    if (!getToken()) return;
    dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'saving' } });
    const csv = storesToCsv(state.stores);
    saveStoresCsv(csv)
      .then(() => {
        dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'saved' } });
      })
      .catch((err) => {
        dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, [state.stores]);

  // Load alerts from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchAlertsCsv()
      .then(({ content }) => {
        if (content) {
          const parsed = parseAlertsCsv(content);
          // Deduplicate by refNumber (keep last occurrence)
          const deduped = {};
          parsed.forEach(a => { if (a.refNumber) deduped[a.refNumber] = a; });
          // Prune alerts older than 30 days
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 30);
          const cutoffStr = localDateStr(cutoff);
          const alerts = Object.values(deduped).filter(a => !a.dateReceived || a.dateReceived >= cutoffStr);
          dispatch({ type: 'LOAD_ALERTS', payload: alerts });
        }
      })
      .catch((err) => {
        console.error('Failed to load alerts:', err);
      });
  }, []);

  // Auto-save alerts to GitHub when they change (debounced 2s)
  const prevAlertsRef = useRef(state.alerts);
  const alertSaveTimerRef = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevAlertsRef.current === state.alerts) return;
    prevAlertsRef.current = state.alerts;
    if (state.alerts.length === 0) return;

    if (alertSaveTimerRef.current) clearTimeout(alertSaveTimerRef.current);
    dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'saving' } });
    alertSaveTimerRef.current = setTimeout(() => {
      const csv = alertsToCsv(state.alerts);
      saveAlertsCsv(csv)
        .then(() => {
          dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'saved' } });
        })
        .catch((err) => {
          console.error('Failed to save alerts:', err);
          dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'error', error: err.message } });
        });
    }, 2000);

    return () => { if (alertSaveTimerRef.current) clearTimeout(alertSaveTimerRef.current); };
  }, [state.alerts]);

  // Re-match alerts against stores to fix stale/wrong matches (e.g. "Food Lion 2560" matched to "Walmart 2560")
  function reMatchAlerts(alerts, stores) {
    let fixed = 0;
    alerts.forEach(alert => {
      const store = matchAlertToStore(alert, stores);
      if (store && store.id !== alert.storeId) {
        alert.storeId = store.id;
        alert.routeNumber = store.routeNumber || '';
        fixed++;
      } else if (store && !alert.storeId) {
        alert.storeId = store.id;
        alert.routeNumber = store.routeNumber || '';
        fixed++;
      }
    });
    if (fixed > 0) console.log(`[Alerts] Re-matched ${fixed} alert(s) to correct stores.`);
  }

  // Label resolved alert emails as "GLOBAL WORKS/Done" in Gmail
  // An alert is "Done" if:
  //   1. Store was visited/had a sale AFTER the alert date, OR
  //   2. Alert was accepted and the 48hr resolution window has expired
  function markResolvedAlertsDone(alerts, stores, vh) {
    if (!isGmailConnected()) return;
    const now = new Date();
    const sMap = {};
    stores.forEach(s => { sMap[s.id] = s; });
    const vhData = vh || state.visitHistory || {};

    const toMark = alerts.filter(a => {
      if (!a.emailId || a.globalworxDone) return false;
      if (!a.dateReceived) return false;

      // Condition 1: Store visited after alert date
      const store = sMap[a.storeId];
      if (store) {
        const vhDates = (vhData[a.storeId] || []).filter(Boolean).map(d => d.split('T')[0]);
        const newestVH = vhDates.length > 0 ? vhDates.sort().pop() : null;
        const storeLastVisited = store.lastVisited ? store.lastVisited.split('T')[0].split(' ')[0] : null;
        const bestLastVisited = [storeLastVisited, newestVH].filter(Boolean).sort().pop() || null;
        const lastVisited = [store.lastSaleDate, bestLastVisited]
          .filter(Boolean).sort().pop() || null;
        if (lastVisited) {
          const visitDate = lastVisited.split('T')[0].split(' ')[0];
          if (visitDate >= a.dateReceived) return true;
        }
      }

      return false;
    });

    if (toMark.length > 0) {
      labelAlertsDone(toMark.map(a => a.emailId));
      toMark.forEach(a => { a.globalworxDone = true; });
      console.log(`[Alerts] ${toMark.length} resolved alert(s) queued for "Done" label.`);
    }
  }

  // Auto-complete Done alerts: click "Complete Here" on GlobalWorx, then label Gmail
  // Eligible: globalworxDone + has acceptanceUrl + not yet globalworxCompleted + not yet globalworxError
  let _completingInProgress = false;
  // Track click failures per refNumber — after 2 failed cycles, apply Error label
  const _completeRetryCount = {};
  const MAX_COMPLETE_RETRIES = 2;

  async function autoCompleteAlerts(alerts) {
    if (!isGmailConnected()) return;
    if (_completingInProgress) {
      console.log('[Alerts] autoCompleteAlerts already running — skipping duplicate call');
      return;
    }
    _completingInProgress = true;
    try { await _doAutoComplete(alerts); } finally { _completingInProgress = false; }
  }
  async function _doAutoComplete(alerts) {

    const toComplete = alerts.filter(a => {
      if (!a.emailId || a.globalworxCompleted) return false;
      if (a.globalworxError) return false;
      if (!a.globalworxDone) return false;
      if (!a.acceptanceUrl) return false;
      return true;
    });

    if (toComplete.length === 0) return;

    console.log(`[Alerts] ${toComplete.length} done alert(s) eligible for GlobalWorx completion`);

    // Try to click "Complete Here" on GlobalWorx via Puppeteer backend
    try {
      const payload = toComplete.map(a => ({
        url: a.acceptanceUrl,
        refNumber: a.refNumber,
        emailId: a.emailId,
      }));
      const { results } = await gwCompleteAlerts(payload);

      // Store scraped GlobalWorx details on each alert (flatten to top-level fields for CSV persistence)
      results.forEach(r => {
        if (r.alertDetails) {
          const alert = toComplete.find(a => a.refNumber === r.refNumber);
          if (alert) {
            alert.gwDetails = r.alertDetails;
            const d = r.alertDetails.details || {};
            if (d['Created By']) alert.gwCreatedBy = d['Created By'];
            if (d['Alert Type']) alert.gwAlertType = d['Alert Type'];
            if (d['Reason']) alert.gwReason = d['Reason'];
          }
        }
      });

      // Only label alerts as Completed if the GW completion succeeded OR the page
      // confirmed it was already completed. Do NOT label if the alert was never accepted
      // (backend returns notAccepted=true when "Accept Here" button is still showing).
      const successIds = [];
      const notAccepted = [];
      const clickFailed = [];
      results.forEach(r => {
        if (r.notAccepted) {
          notAccepted.push(r.refNumber);
        } else if (r.success) {
          // Only label as Completed if the Complete button was actually clicked (verified)
          successIds.push(r.emailId);
          // Clear retry count on success
          delete _completeRetryCount[r.refNumber];
        } else if (r.clickFailed) {
          // Button was found but click didn't register after all attempts
          clickFailed.push(r.refNumber);
        }
        // success=false without notAccepted/clickFailed = other error, don't label
      });
      const emailIds = successIds.filter(Boolean);
      if (emailIds.length > 0) {
        await labelAlertsCompleted(emailIds);
        toComplete.filter(a => emailIds.includes(a.emailId)).forEach(a => { a.globalworxCompleted = true; });
      }

      // Handle click failures — retry up to MAX_COMPLETE_RETRIES, then apply Error label
      if (clickFailed.length > 0) {
        const errorRefNumbers = [];
        clickFailed.forEach(ref => {
          _completeRetryCount[ref] = (_completeRetryCount[ref] || 0) + 1;
          console.warn(`[Alerts] Click failed for ${ref} — attempt ${_completeRetryCount[ref]}/${MAX_COMPLETE_RETRIES}`);
          if (_completeRetryCount[ref] >= MAX_COMPLETE_RETRIES) {
            errorRefNumbers.push(ref);
            delete _completeRetryCount[ref];
          }
        });

        // Apply Error label to alerts that exhausted retries
        if (errorRefNumbers.length > 0) {
          const errorAlerts = toComplete.filter(a => errorRefNumbers.includes(a.refNumber));
          const errorEmailIds = errorAlerts.map(a => a.emailId).filter(Boolean);
          if (errorEmailIds.length > 0) {
            console.error(`[Alerts] Applying Error label to ${errorRefNumbers.length} alert(s) after ${MAX_COMPLETE_RETRIES} failed attempts: ${errorRefNumbers.join(', ')}`);
            await labelAlertsError(errorEmailIds);
            errorAlerts.forEach(a => { a.globalworxError = true; });
          }
        }
      }

      // Strip false Done/Completed labels from alerts that were never accepted on GlobalWorx
      if (notAccepted.length > 0) {
        const notAcceptedAlerts = toComplete.filter(a => notAccepted.includes(a.refNumber));
        const stripIds = notAcceptedAlerts.map(a => a.emailId).filter(Boolean);
        if (stripIds.length > 0) {
          console.warn(`[Alerts] Stripping Done/Completed labels from ${stripIds.length} falsely-labeled alert(s): ${notAccepted.join(', ')}`);
          await unlabelAlertsDoneAndCompleted(stripIds);
          notAcceptedAlerts.forEach(a => {
            a.globalworxDone = false;
            a.globalworxCompleted = false;
          });
        }
      }
      const completed = results.filter(r => r.success).length;
      const clickFailedCount = clickFailed.length;
      const alreadyClosed = results.filter(r => !r.success && !r.notAccepted && !r.clickFailed).length;
      console.log(`[Alerts] GlobalWorx completion: ${completed} completed, ${clickFailedCount} click failed (will retry), ${alreadyClosed} already closed, ${notAccepted.length} not accepted. ${emailIds.length} labeled in Gmail.`);
    } catch (err) {
      console.warn('[Alerts] GlobalWorx completion service unavailable — not labeling (will retry next cycle):', err.message);
    }
  }

  // Fetch new alerts from Gmail — merges with existing, dedupes by refNumber, prunes >30 days
  // @param {string} [date] - YYYY-MM-DD date to fetch alerts for (defaults to today)
  // Returns { newCount, rawMessages } for debug display
  const fetchGmailAlerts = useCallback(async (date) => {
    if (!isGmailConnected()) throw new Error('Not connected to Gmail');

    dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'loading' } });

    try {
      // Gmail 'after:' is exclusive (emails AFTER that date, not including it)
      // So always subtract 1 day from the target date
      let afterDate;
      if (date) {
        const d = new Date(date + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        afterDate = localDateStr(d);
      } else {
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        afterDate = localDateStr(monthAgo);
      }

      const { alerts: newAlerts, rawMessages } = await fetchAlertEmails(afterDate);

      // Match each alert to a store
      newAlerts.forEach(alert => {
        const store = matchAlertToStore(alert, state.stores);
        if (store) {
          alert.storeId = store.id;
          alert.routeNumber = store.routeNumber || '';
        }
      });

      // Merge: existing alerts by refNumber, new overwrite duplicates
      const alertMap = {};
      state.alerts.forEach(a => { if (a.refNumber) alertMap[a.refNumber] = a; });
      newAlerts.forEach(a => { if (a.refNumber) alertMap[a.refNumber] = a; });

      // Prune alerts older than 30 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = localDateStr(cutoff);
      const merged = Object.values(alertMap).filter(a =>
        !a.dateReceived || a.dateReceived >= cutoffStr
      );

      // Re-match ALL alerts against current stores (fixes stale/wrong matches)
      reMatchAlerts(merged, state.stores);

      dispatch({ type: 'SET_ALERTS', payload: merged });

      // Label fetched messages in Gmail (non-blocking)
      const messageIds = newAlerts.map(a => a.emailId).filter(Boolean);
      if (messageIds.length > 0) {
        labelAlertMessages(messageIds);
      }

      // Mark resolved alerts as "GLOBAL WORKS/Done" in Gmail (non-blocking)
      markResolvedAlertsDone(merged, state.stores);

      // Mark Done alerts 48h+ as "GLOBAL WORKS/Completed" in Gmail (non-blocking)
      autoCompleteAlerts(merged);

      return { newCount: newAlerts.length, rawMessages };
    } catch (err) {
      dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      throw err;
    }
  }, [state.stores, state.alerts]);

  const loadAlertImage = useCallback(async (emailId) => {
    if (!emailId) return null;
    dispatch({ type: 'SET_ALERT_IMAGE', payload: { emailId, loading: true, error: null, dataUri: null } });
    try {
      const result = await fetchAlertImageApi(emailId);
      if (result) {
        dispatch({ type: 'SET_ALERT_IMAGE', payload: { emailId, loading: false, error: null, ...result } });
        return result;
      } else {
        dispatch({ type: 'SET_ALERT_IMAGE', payload: { emailId, loading: false, error: 'No image found', dataUri: null } });
        return null;
      }
    } catch (err) {
      dispatch({ type: 'SET_ALERT_IMAGE', payload: { emailId, loading: false, error: err.message, dataUri: null } });
      return null;
    }
  }, []);

  // Auto-accept unaccepted alerts via GlobalWorx backend (Puppeteer)
  const autoAcceptAlerts = useCallback(async () => {
    const unaccepted = state.alerts.filter(a =>
      a.acceptanceUrl && !a.globalworxAccepted && !a.globalworxDone && !a.globalworxCompleted
    );
    if (unaccepted.length === 0) return { accepted: 0, failed: 0, total: 0 };

    const payload = unaccepted.map(a => ({
      url: a.acceptanceUrl,
      refNumber: a.refNumber,
      emailId: a.emailId,
    }));

    const { results } = await gwAcceptAlerts(payload);

    // Store scraped GlobalWorx details on each alert (flatten to top-level fields for CSV persistence)
    results.forEach(r => {
      if (r.alertDetails) {
        const alert = unaccepted.find(a => a.refNumber === r.refNumber);
        if (alert) {
          alert.gwDetails = r.alertDetails;
          const d = r.alertDetails.details || {};
          if (d['Created By']) alert.gwCreatedBy = d['Created By'];
          if (d['Alert Type']) alert.gwAlertType = d['Alert Type'];
          if (d['Reason']) alert.gwReason = d['Reason'];
        }
      }
    });

    // Label successfully accepted emails as "Processed" in Gmail (marks globalworxAccepted = true on next fetch)
    const acceptedIds = results.filter(r => r.success && r.emailId).map(r => r.emailId);
    const gmailOk = isGmailConnected();
    console.log(`[AutoAccept] ${results.filter(r => r.success).length} accepted, ${acceptedIds.length} have emailId, gmailConnected=${gmailOk}`);
    if (acceptedIds.length > 0 && gmailOk) {
      await labelAlertsProcessed(acceptedIds);
    } else if (acceptedIds.length === 0) {
      console.warn('[AutoAccept] No emailIds found on accepted alerts — label skipped. Try re-fetching Gmail alerts first.');
    } else if (!gmailOk) {
      console.warn('[AutoAccept] Gmail token expired — label skipped. Reconnect Gmail and re-run.');
    }

    // Mark aborted alerts (48hr resolution not set) as errors — label Gmail + update state
    const abortedResults = results.filter(r => r.abortedResolution);
    if (abortedResults.length > 0) {
      const abortedAlerts = abortedResults.map(r => unaccepted.find(a => a.refNumber === r.refNumber)).filter(Boolean);
      abortedAlerts.forEach(a => { a.globalworxError = true; });
      const abortedEmailIds = abortedAlerts.map(a => a.emailId).filter(Boolean);
      if (abortedEmailIds.length > 0 && gmailOk) {
        await labelAlertsError(abortedEmailIds);
      }
      console.error(`[AutoAccept] ${abortedAlerts.length} alert(s) aborted — 48hr resolution could not be set: ${abortedResults.map(r => r.refNumber).join(', ')}`);
      // Force state update so UI shows error badges immediately
      dispatch({ type: 'LOAD_ALERTS', payload: [...state.alerts] });
    }

    const accepted = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    return { accepted, failed, aborted: abortedResults.length, total: unaccepted.length, results };
  }, [state.alerts]);

  const syncAlertsFromGithub = useCallback(() => {
    if (!getToken()) return;
    dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'loading' } });
    fetchAlertsCsv()
      .then(({ content }) => {
        if (content) {
          const alerts = parseAlertsCsv(content);
          dispatch({ type: 'LOAD_ALERTS', payload: alerts });
        } else {
          dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'saved' } });
        }
      })
      .catch((err) => {
        dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, []);

  // Load schedules from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchSchedulesJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          dispatch({ type: 'LOAD_SCHEDULES', payload: data });
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load schedules:', err);
      });
  }, []);

  // Save schedule to GitHub
  const saveSchedule = useCallback((key, scheduleData) => {
    dispatch({ type: 'SET_SCHEDULE', payload: { key, schedule: scheduleData } });
  }, []);

  // Auto-save schedules to GitHub when they change
  const prevSchedulesRef = useRef(state.schedules);
  const schedulesSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevSchedulesRef.current === state.schedules) return;
    prevSchedulesRef.current = state.schedules;
    if (Object.keys(state.schedules).length === 0) return;

    if (schedulesSaveTimer.current) clearTimeout(schedulesSaveTimer.current);
    schedulesSaveTimer.current = setTimeout(() => {
      saveSchedulesJson(JSON.stringify(state.schedules))
        .catch((err) => console.error('Failed to save schedules:', err));
    }, 2000);

    return () => { if (schedulesSaveTimer.current) clearTimeout(schedulesSaveTimer.current); };
  }, [state.schedules]);

  // Load visit history from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchVisitHistoryJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          dispatch({ type: 'LOAD_VISIT_HISTORY', payload: data });
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load visit history:', err);
      });
  }, []);

  // Auto-save visit history to GitHub when it changes
  const prevVisitHistoryRef = useRef(state.visitHistory);
  const visitHistorySaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevVisitHistoryRef.current === state.visitHistory) return;
    prevVisitHistoryRef.current = state.visitHistory;
    if (Object.keys(state.visitHistory).length === 0) return;

    if (visitHistorySaveTimer.current) clearTimeout(visitHistorySaveTimer.current);
    visitHistorySaveTimer.current = setTimeout(() => {
      saveVisitHistoryJson(JSON.stringify(state.visitHistory))
        .catch((err) => console.error('Failed to save visit history:', err));
    }, 2000);

    return () => { if (visitHistorySaveTimer.current) clearTimeout(visitHistorySaveTimer.current); };
  }, [state.visitHistory]);

  // Load import log from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchImportLog()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            dispatch({ type: 'LOAD_IMPORT_LOG', payload: data });
          }
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load import log:', err);
      });
  }, []);

  const addImportEntry = useCallback((entry) => {
    dispatch({ type: 'ADD_IMPORT_ENTRY', payload: { id: uuidv4(), timestamp: new Date().toISOString(), ...entry } });
  }, []);

  // Auto-save import log to GitHub when it changes
  const prevImportLogRef = useRef(state.importLog);
  const importLogSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevImportLogRef.current === state.importLog) return;
    prevImportLogRef.current = state.importLog;
    if (state.importLog.length === 0) return;

    if (importLogSaveTimer.current) clearTimeout(importLogSaveTimer.current);
    importLogSaveTimer.current = setTimeout(() => {
      saveImportLog(JSON.stringify(state.importLog))
        .catch((err) => console.error('Failed to save import log:', err));
    }, 2000);

    return () => { if (importLogSaveTimer.current) clearTimeout(importLogSaveTimer.current); };
  }, [state.importLog]);

  // Load warehouses from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchWarehousesJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            dispatch({ type: 'LOAD_WAREHOUSES', payload: data });
          }
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load warehouses:', err);
      });
  }, []);

  // Auto-save warehouses to GitHub when they change
  const prevWarehousesRef = useRef(state.warehouses);
  const warehousesSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevWarehousesRef.current === state.warehouses) return;
    prevWarehousesRef.current = state.warehouses;

    if (warehousesSaveTimer.current) clearTimeout(warehousesSaveTimer.current);
    warehousesSaveTimer.current = setTimeout(() => {
      saveWarehousesJson(JSON.stringify(state.warehouses))
        .catch((err) => console.error('Failed to save warehouses:', err));
    }, 2000);

    return () => { if (warehousesSaveTimer.current) clearTimeout(warehousesSaveTimer.current); };
  }, [state.warehouses]);

  // Load travel log from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchTravelLogJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          dispatch({ type: 'LOAD_TRAVEL_LOG', payload: data });
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load travel log:', err);
      });
  }, []);

  // Auto-save travel log to GitHub when it changes
  const prevTravelLogRef = useRef(state.travelLog);
  const travelLogSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevTravelLogRef.current === state.travelLog) return;
    prevTravelLogRef.current = state.travelLog;
    if (Object.keys(state.travelLog).length === 0) return;

    if (travelLogSaveTimer.current) clearTimeout(travelLogSaveTimer.current);
    travelLogSaveTimer.current = setTimeout(() => {
      // Prune entries older than 40 days before saving
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 40);
      const cutoffStr = localDateStr(cutoff);
      const pruned = {};
      for (const [date, vehicles] of Object.entries(state.travelLog)) {
        if (date >= cutoffStr) pruned[date] = vehicles;
      }
      saveTravelLogJson(JSON.stringify(pruned))
        .catch((err) => console.error('Failed to save travel log:', err));
    }, 2000);

    return () => { if (travelLogSaveTimer.current) clearTimeout(travelLogSaveTimer.current); };
  }, [state.travelLog]);

  // Load address overrides from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchAddressOverridesJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          dispatch({ type: 'LOAD_ADDRESS_OVERRIDES', payload: data });
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load address overrides:', err);
      });
  }, []);

  // Auto-save address overrides to GitHub when they change
  const prevAddressOverridesRef = useRef(state.addressOverrides);
  const addressOverridesSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevAddressOverridesRef.current === state.addressOverrides) return;
    prevAddressOverridesRef.current = state.addressOverrides;
    if (Object.keys(state.addressOverrides).length === 0) return;

    if (addressOverridesSaveTimer.current) clearTimeout(addressOverridesSaveTimer.current);
    addressOverridesSaveTimer.current = setTimeout(() => {
      saveAddressOverridesJson(JSON.stringify(state.addressOverrides))
        .catch((err) => console.error('Failed to save address overrides:', err));
    }, 2000);

    return () => { if (addressOverridesSaveTimer.current) clearTimeout(addressOverridesSaveTimer.current); };
  }, [state.addressOverrides]);

  // Load custom locations from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchCustomLocationsJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            dispatch({ type: 'LOAD_CUSTOM_LOCATIONS', payload: data });
          }
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load custom locations:', err);
      });
  }, []);

  // Auto-save custom locations to GitHub when they change
  const prevCustomLocationsRef = useRef(state.customLocations);
  const customLocationsSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevCustomLocationsRef.current === state.customLocations) return;
    prevCustomLocationsRef.current = state.customLocations;

    if (customLocationsSaveTimer.current) clearTimeout(customLocationsSaveTimer.current);
    customLocationsSaveTimer.current = setTimeout(() => {
      saveCustomLocationsJson(JSON.stringify(state.customLocations))
        .catch((err) => console.error('Failed to save custom locations:', err));
    }, 2000);

    return () => { if (customLocationsSaveTimer.current) clearTimeout(customLocationsSaveTimer.current); };
  }, [state.customLocations]);

  // Load transactions from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchTransactionsJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            dispatch({ type: 'LOAD_TRANSACTIONS', payload: data });
          }
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load transactions:', err);
      });
  }, []);

  // Auto-save transactions to GitHub when they change
  const prevTransactionsRef = useRef(state.transactions);
  const transactionsSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevTransactionsRef.current === state.transactions) return;
    prevTransactionsRef.current = state.transactions;

    if (transactionsSaveTimer.current) clearTimeout(transactionsSaveTimer.current);
    transactionsSaveTimer.current = setTimeout(() => {
      saveTransactionsJson(JSON.stringify(state.transactions))
        .catch((err) => console.error('Failed to save transactions:', err));
    }, 2000);

    return () => { if (transactionsSaveTimer.current) clearTimeout(transactionsSaveTimer.current); };
  }, [state.transactions]);

  // Load warehouse orders — local disk first (instant), then GitHub (authoritative)
  useEffect(() => {
    // 1. Try local disk via WhatsApp service (fast, works offline)
    loadLocalData('warehouseOrders').then(localData => {
      if (localData && localData.orders) {
        console.log('[WO] Loaded from local disk:', localData.orders.length, 'orders');
        dispatch({ type: 'LOAD_WAREHOUSE_ORDERS', payload: localData });
      }
    });

    // 2. Also load from GitHub if token available (may overwrite with newer remote data)
    if (!getToken()) return;
    fetchWarehouseOrdersJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          if (data && data.orders) {
            console.log('[WO] Loaded from GitHub:', data.orders.length, 'orders');
            dispatch({ type: 'LOAD_WAREHOUSE_ORDERS', payload: data });
            // Mirror to local disk so next load is instant
            saveLocalData('warehouseOrders', data);
          }
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('[WO] Failed to load from GitHub:', err);
      });
  }, []);

  // Auto-save warehouse orders to localStorage + local disk + GitHub when they change
  const prevWarehouseOrdersRef = useRef(state.warehouseOrders);
  const warehouseOrdersSaveTimer = useRef(null);
  useEffect(() => {
    if (prevWarehouseOrdersRef.current === state.warehouseOrders) return;
    prevWarehouseOrdersRef.current = state.warehouseOrders;

    // 1. Save to localStorage (instant, browser-specific)
    try { localStorage.setItem('warehouseOrders', JSON.stringify(state.warehouseOrders)); } catch { /* quota */ }

    // 2. Save to local disk via WhatsApp service (instant, persists across browsers/machines)
    saveLocalData('warehouseOrders', state.warehouseOrders)
      .then(ok => { if (ok) localStorage.setItem('wo_last_local_saved', new Date().toISOString()); })
      .catch((err) => console.error('[WO] Local disk save failed:', err));

    // 3. Save to GitHub (debounced 2s — remote backup)
    if (!getToken()) return;
    if (warehouseOrdersSaveTimer.current) clearTimeout(warehouseOrdersSaveTimer.current);
    warehouseOrdersSaveTimer.current = setTimeout(() => {
      saveWarehouseOrdersJson(JSON.stringify(state.warehouseOrders))
        .then(() => localStorage.setItem('wo_last_github_saved', new Date().toISOString()))
        .catch((err) => console.error('[WO] GitHub save failed:', err));
    }, 2000);

    return () => { if (warehouseOrdersSaveTimer.current) clearTimeout(warehouseOrdersSaveTimer.current); };
  }, [state.warehouseOrders]);

  // Load inventory — local disk first, then GitHub
  useEffect(() => {
    loadLocalData('inventory').then(localData => {
      if (localData && localData.items) dispatch({ type: 'LOAD_INVENTORY', payload: localData });
    });
    if (!getToken()) return;
    fetchInventoryJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          if (data && data.items) {
            dispatch({ type: 'LOAD_INVENTORY', payload: data });
            saveLocalData('inventory', data);
          }
        } catch { /* empty */ }
      })
      .catch(() => {});
  }, []);

  // Auto-save inventory
  const prevInventoryRef = useRef(state.inventory);
  const inventorySaveTimer = useRef(null);
  useEffect(() => {
    if (prevInventoryRef.current === state.inventory) return;
    prevInventoryRef.current = state.inventory;
    try { localStorage.setItem('inventoryData', JSON.stringify(state.inventory)); } catch { /* quota */ }
    saveLocalData('inventory', state.inventory).catch(() => {});
    if (!getToken()) return;
    if (inventorySaveTimer.current) clearTimeout(inventorySaveTimer.current);
    inventorySaveTimer.current = setTimeout(() => {
      saveInventoryJson(JSON.stringify(state.inventory)).catch(() => {});
    }, 2000);
    return () => { if (inventorySaveTimer.current) clearTimeout(inventorySaveTimer.current); };
  }, [state.inventory]);

  const actions = {
    addStore: useCallback(
      (store) => dispatch({ type: 'ADD_STORE', payload: store }),
      []
    ),
    updateStore: useCallback(
      (store) => dispatch({ type: 'UPDATE_STORE', payload: store }),
      []
    ),
    deleteStore: useCallback(
      (id) => dispatch({ type: 'DELETE_STORE', payload: id }),
      []
    ),
    addZone: useCallback(
      (zone) => dispatch({ type: 'ADD_ZONE', payload: zone }),
      []
    ),
    updateZone: useCallback(
      (zone) => dispatch({ type: 'UPDATE_ZONE', payload: zone }),
      []
    ),
    deleteZone: useCallback(
      (id) => dispatch({ type: 'DELETE_ZONE', payload: id }),
      []
    ),
    addSubZone: useCallback(
      (zoneId, subZone) =>
        dispatch({ type: 'ADD_SUBZONE', payload: { zoneId, subZone } }),
      []
    ),
    updateSubZone: useCallback(
      (zoneId, subZone) =>
        dispatch({ type: 'UPDATE_SUBZONE', payload: { zoneId, subZone } }),
      []
    ),
    deleteSubZone: useCallback(
      (zoneId, subZoneId) =>
        dispatch({ type: 'DELETE_SUBZONE', payload: { zoneId, subZoneId } }),
      []
    ),
    selectStore: useCallback(
      (id) => dispatch({ type: 'SELECT_STORE', payload: id }),
      []
    ),
    selectZone: useCallback(
      (id) => dispatch({ type: 'SELECT_ZONE', payload: id }),
      []
    ),
    selectSubZone: useCallback(
      (id) => dispatch({ type: 'SELECT_SUBZONE', payload: id }),
      []
    ),
    setSidebarTab: useCallback(
      (tab) => dispatch({ type: 'SET_SIDEBAR_TAB', payload: tab }),
      []
    ),
    setSearch: useCallback(
      (term) => dispatch({ type: 'SET_SEARCH', payload: term }),
      []
    ),
    setFilterRegion: useCallback(
      (region) => dispatch({ type: 'SET_FILTER_REGION', payload: region }),
      []
    ),
    setFilterType: useCallback(
      (type) => dispatch({ type: 'SET_FILTER_TYPE', payload: type }),
      []
    ),
    setFilterRoute: useCallback(
      (route) => dispatch({ type: 'SET_FILTER_ROUTE', payload: route }),
      []
    ),
    setPage: useCallback(
      (page) => dispatch({ type: 'SET_PAGE', payload: page }),
      []
    ),
    setMapView: useCallback(
      (center, zoom) =>
        dispatch({ type: 'SET_MAP_VIEW', payload: { center, zoom } }),
      []
    ),
    syncFromGithub,
    saveToGithub,
    fetchGmailAlerts,
    autoAcceptAlerts,
    autoCompleteAlerts,
    syncAlertsFromGithub,
    loadAlertImage,
    saveSchedule,
    addImportEntry,
    clearAlerts: useCallback(() => dispatch({ type: 'SET_ALERTS', payload: [] }), []),
    bulkImportStores: useCallback(
      (updates, additions) => dispatch({ type: 'BULK_IMPORT_STORES', payload: { updates, additions } }),
      []
    ),
    recordVisit: useCallback(
      (storeId, date) => dispatch({ type: 'RECORD_VISIT', payload: { storeId, date } }),
      []
    ),
    bulkRecordVisits: useCallback(
      (entries) => dispatch({ type: 'BULK_RECORD_VISITS', payload: entries }),
      []
    ),
    updateVehicleLocations: useCallback(
      (locations) => dispatch({ type: 'SET_VEHICLE_LOCATIONS', payload: locations }),
      []
    ),
    setFleetSyncStatus: useCallback(
      (status, error) => dispatch({ type: 'SET_FLEET_SYNC_STATUS', payload: { status, error } }),
      []
    ),
    toggleVehiclesOnMap: useCallback(
      () => dispatch({ type: 'TOGGLE_VEHICLES_ON_MAP' }),
      []
    ),
    setVehiclesOnMap: useCallback(
      (show) => dispatch({ type: 'SET_VEHICLES_ON_MAP', payload: show }),
      []
    ),
    // Warehouses
    setWarehouses: useCallback(
      (warehouses) => dispatch({ type: 'SET_WAREHOUSES', payload: warehouses }),
      []
    ),
    // Travel log
    logTravelEntries: useCallback(
      (entries) => dispatch({ type: 'LOG_TRAVEL_ENTRIES', payload: entries }),
      []
    ),
    manualMatchEntries: useCallback(
      (updates) => dispatch({ type: 'MANUAL_MATCH_ENTRIES', payload: updates }),
      []
    ),
    unmatchEntry: useCallback(
      (vehicleVin, date, locationId) => dispatch({ type: 'UNMATCH_ENTRY', payload: { vehicleVin, date, locationId } }),
      []
    ),
    toggleAutoVisit: useCallback(
      () => dispatch({ type: 'TOGGLE_AUTO_VISIT' }),
      []
    ),
    // Address overrides
    setAddressOverride: useCallback(
      (destination, storeId) => dispatch({ type: 'SET_ADDRESS_OVERRIDE', payload: { destination, storeId } }),
      []
    ),
    removeAddressOverride: useCallback(
      (destination) => dispatch({ type: 'REMOVE_ADDRESS_OVERRIDE', payload: { destination } }),
      []
    ),
    // Custom locations
    addCustomLocation: useCallback(
      (location) => dispatch({ type: 'ADD_CUSTOM_LOCATION', payload: location }),
      []
    ),
    updateCustomLocation: useCallback(
      (location) => dispatch({ type: 'UPDATE_CUSTOM_LOCATION', payload: location }),
      []
    ),
    deleteCustomLocation: useCallback(
      (id) => dispatch({ type: 'DELETE_CUSTOM_LOCATION', payload: id }),
      []
    ),
    // Transactions
    setTransactions: useCallback(
      (transactions) => dispatch({ type: 'SET_TRANSACTIONS', payload: transactions }),
      []
    ),
    addWarehouseOrder: useCallback(
      (order) => dispatch({ type: 'ADD_WAREHOUSE_ORDER', payload: order }),
      []
    ),
    updateWarehouseOrder: useCallback(
      (order) => dispatch({ type: 'UPDATE_WAREHOUSE_ORDER', payload: order }),
      []
    ),
    deleteWarehouseOrder: useCallback(
      (id) => dispatch({ type: 'DELETE_WAREHOUSE_ORDER', payload: id }),
      []
    ),
    setWarehouseOrders: useCallback(
      (orders) => dispatch({ type: 'SET_WAREHOUSE_ORDERS', payload: orders }),
      []
    ),
    setLanguage: useCallback(
      (lang) => dispatch({ type: 'SET_LANGUAGE', payload: lang }),
      []
    ),
    setInventory: useCallback(
      (inv) => dispatch({ type: 'SET_INVENTORY', payload: inv }),
      []
    ),
    deductInventory: useCallback(
      (sku, units) => dispatch({ type: 'DEDUCT_INVENTORY', payload: { sku, units } }),
      []
    ),
  };

  return (
    <AppContext.Provider value={{ state, ...actions }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
