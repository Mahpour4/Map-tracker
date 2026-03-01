import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';

export default function Inventory() {
  const { state, setInventory } = useApp();
  const { inventory } = state;
  const items = inventory?.items || {};

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('remaining'); // remaining | description | incoming | sold
  const [sortDir, setSortDir] = useState('asc');
  const [editSku, setEditSku] = useState(null); // sku being manually edited
  const [editVal, setEditVal] = useState({});

  const rows = useMemo(() => {
    return Object.values(items)
      .map(item => {
        const incoming = item.incoming || 0;
        const sold = item.sold || 0;
        const remaining = incoming - sold;
        const pct = incoming > 0 ? Math.round((remaining / incoming) * 100) : 0;
        return { ...item, remaining, pct };
      })
      .filter(item =>
        !search ||
        item.description.toLowerCase().includes(search.toLowerCase()) ||
        item.sku.includes(search)
      )
      .sort((a, b) => {
        let av = a[sortBy], bv = b[sortBy];
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [items, search, sortBy, sortDir]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.incoming += r.incoming;
      acc.sold += r.sold;
      acc.remaining += r.remaining;
      return acc;
    }, { incoming: 0, sold: 0, remaining: 0 });
  }, [rows]);

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  function sortIcon(col) {
    if (sortBy !== col) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  function startEdit(item) {
    setEditSku(item.sku);
    setEditVal({ incoming: item.incoming, sold: item.sold });
  }

  function saveEdit(sku) {
    const incoming = parseFloat(editVal.incoming) || 0;
    const sold = parseFloat(editVal.sold) || 0;
    setInventory({
      ...inventory,
      items: {
        ...items,
        [sku]: { ...items[sku], incoming, sold },
      },
      lastUpdated: new Date().toISOString().split('T')[0],
    });
    setEditSku(null);
  }

  function resetSold(sku) {
    setInventory({
      ...inventory,
      items: { ...items, [sku]: { ...items[sku], sold: 0 } },
      lastUpdated: new Date().toISOString().split('T')[0],
    });
  }

  function statusClass(pct, remaining) {
    if (remaining <= 0) return 'inv-status-out';
    if (pct < 20) return 'inv-status-low';
    return 'inv-status-ok';
  }

  return (
    <div className="inv-page">
      <div className="inv-header">
        <div className="inv-title-row">
          <h2 className="inv-title">Inventory</h2>
          <span className="inv-updated">Last updated: {inventory?.lastUpdated || '—'}</span>
        </div>

        {/* Summary cards */}
        <div className="inv-cards">
          <div className="inv-card">
            <div className="inv-card-label">Total Incoming</div>
            <div className="inv-card-val">{totals.incoming.toLocaleString()}</div>
          </div>
          <div className="inv-card inv-card-sold">
            <div className="inv-card-label">Total Sold</div>
            <div className="inv-card-val">{totals.sold.toLocaleString()}</div>
          </div>
          <div className="inv-card inv-card-remaining">
            <div className="inv-card-label">Remaining</div>
            <div className="inv-card-val">{totals.remaining.toLocaleString()}</div>
          </div>
          <div className="inv-card inv-card-pct">
            <div className="inv-card-label">SKUs Tracked</div>
            <div className="inv-card-val">{Object.keys(items).length}</div>
          </div>
        </div>
      </div>

      <div className="inv-controls">
        <input
          className="inv-search"
          type="text"
          placeholder="Search by SKU or description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button className="inv-clear-search" onClick={() => setSearch('')}>Clear</button>}
      </div>

      <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th className="inv-th-sku" onClick={() => toggleSort('sku')}>SKU{sortIcon('sku')}</th>
              <th className="inv-th-desc" onClick={() => toggleSort('description')}>Description{sortIcon('description')}</th>
              <th className="inv-th-num" onClick={() => toggleSort('incoming')}>Incoming{sortIcon('incoming')}</th>
              <th className="inv-th-num" onClick={() => toggleSort('sold')}>Sold{sortIcon('sold')}</th>
              <th className="inv-th-num" onClick={() => toggleSort('remaining')}>Remaining{sortIcon('remaining')}</th>
              <th className="inv-th-pct">%</th>
              <th className="inv-th-notes">Delivery Notes</th>
              <th className="inv-th-actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(item => (
              <tr key={item.sku} className={`inv-row ${statusClass(item.pct, item.remaining)}`}>
                <td className="inv-td-sku">{item.sku}</td>
                <td className="inv-td-desc">{item.description}</td>
                {editSku === item.sku ? (
                  <>
                    <td className="inv-td-num">
                      <input
                        className="inv-edit-input"
                        type="number"
                        value={editVal.incoming}
                        onChange={e => setEditVal(v => ({ ...v, incoming: e.target.value }))}
                      />
                    </td>
                    <td className="inv-td-num">
                      <input
                        className="inv-edit-input"
                        type="number"
                        value={editVal.sold}
                        onChange={e => setEditVal(v => ({ ...v, sold: e.target.value }))}
                      />
                    </td>
                    <td className="inv-td-num">{(parseFloat(editVal.incoming) || 0) - (parseFloat(editVal.sold) || 0)}</td>
                    <td className="inv-td-pct">—</td>
                    <td className="inv-td-notes"></td>
                    <td className="inv-td-actions">
                      <button className="inv-btn inv-btn-save" onClick={() => saveEdit(item.sku)}>Save</button>
                      <button className="inv-btn inv-btn-cancel" onClick={() => setEditSku(null)}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="inv-td-num">{item.incoming.toLocaleString()}</td>
                    <td className="inv-td-num inv-sold">{item.sold > 0 ? item.sold.toLocaleString() : '—'}</td>
                    <td className={`inv-td-num inv-remaining ${item.remaining <= 0 ? 'inv-zero' : ''}`}>
                      {item.remaining.toLocaleString()}
                    </td>
                    <td className="inv-td-pct">
                      <div className="inv-pct-bar-wrap">
                        <div className="inv-pct-bar" style={{ width: `${Math.max(0, item.pct)}%` }}></div>
                        <span className="inv-pct-label">{item.pct}%</span>
                      </div>
                    </td>
                    <td className="inv-td-notes">{item.notes || '—'}</td>
                    <td className="inv-td-actions">
                      <button className="inv-btn inv-btn-edit" onClick={() => startEdit(item)} title="Edit quantities">Edit</button>
                      {item.sold > 0 && (
                        <button className="inv-btn inv-btn-reset" onClick={() => resetSold(item.sku)} title="Reset sold to 0">Reset</button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan="8" className="inv-empty">No items found.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="inv-totals-row">
              <td colSpan="2" className="inv-totals-label">TOTALS ({rows.length} items)</td>
              <td className="inv-td-num">{totals.incoming.toLocaleString()}</td>
              <td className="inv-td-num inv-sold">{totals.sold.toLocaleString()}</td>
              <td className="inv-td-num inv-remaining">{totals.remaining.toLocaleString()}</td>
              <td colSpan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
