import { createContext, useContext, useReducer, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { sampleStores, sampleZones } from '../data/sampleData';

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
  mapCenter: [39.0, -76.8],
  mapZoom: 8,
};

function reassignStores(stores, zones) {
  return stores.map((store) => {
    const zone = zones.find((z) => z.name === store.region);
    if (zone) {
      const subZone = zone.subZones.find((sz) => sz.name === store.territory);
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
    case 'ADD_STORE': {
      const newStore = { id: uuidv4(), ...action.payload };
      const updatedStores = [...state.stores, newStore];
      return { ...state, stores: reassignStores(updatedStores, state.zones) };
    }
    case 'UPDATE_STORE': {
      const updatedStores = state.stores.map((s) =>
        s.id === action.payload.id ? { ...s, ...action.payload } : s
      );
      return { ...state, stores: reassignStores(updatedStores, state.zones) };
    }
    case 'DELETE_STORE':
      return {
        ...state,
        stores: state.stores.filter((s) => s.id !== action.payload),
        selectedStore:
          state.selectedStore === action.payload ? null : state.selectedStore,
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
    case 'SET_MAP_VIEW':
      return {
        ...state,
        mapCenter: action.payload.center,
        mapZoom: action.payload.zoom,
      };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

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
    setMapView: useCallback(
      (center, zoom) =>
        dispatch({ type: 'SET_MAP_VIEW', payload: { center, zoom } }),
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
