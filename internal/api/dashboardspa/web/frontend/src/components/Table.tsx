import { useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';

// A table sits in a white panel on the pavement: sentence-case column
// heads, rows split by hairlines, no bordered cells. The panel scrolls
// sideways on its own so a wide table never widens the page. Tabular
// figures on (apply at the cell level for numeric columns).

export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  render: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right';
}

type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

interface TableProps<T> {
  columns: ReadonlyArray<TableColumn<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowProps?: (row: T) => HTMLAttributes<HTMLTableRowElement>;
  empty?: ReactNode;
  initialSort?: SortState | null;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowProps,
  empty,
  initialSort,
}: TableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);

  const sortedRows = useMemo(() => {
    if (sort === null) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.sortable) return rows;
    const getVal = col.sortValue ?? ((r: T) => String(col.render(r) ?? ''));
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av === bv) return 0;
      if (av === null || av === undefined) return -dir;
      if (bv === null || bv === undefined) return dir;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
  }, [rows, columns, sort]);

  const toggleSort = (key: string) => {
    setSort((cur) => {
      if (cur?.key !== key) return { key, dir: 'asc' };
      return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-rule bg-surface-raised">
      <table className="w-full text-body tnum">
        <thead>
          <tr className="border-b border-rule text-label font-medium text-fg-muted">
            {columns.map((col) => {
              const isSorted = sort?.key === col.key;
              const align = col.align === 'right' ? 'text-right' : 'text-left';
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-2.5 font-medium select-none ${align} ${col.className ?? ''}`}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 rounded-sm transition-colors duration-150 ease-out-quart hover:text-fg focus-mark"
                    >
                      {col.label}
                      {isSorted && (
                        <span aria-hidden className="text-primary">
                          {sort?.dir === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-fg-muted">
                {empty ?? 'No data'}
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => {
              const { className: rowClassName = '', ...extraRowProps } = rowProps?.(row) ?? {};
              return (
                <tr
                  {...extraRowProps}
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-rule transition-colors duration-150 ease-out-quart last:border-0 ${
                    onRowClick ? 'cursor-pointer hover:bg-surface-tint' : ''
                  } ${rowClassName}`}
                >
                  {columns.map((col) => {
                    const align = col.align === 'right' ? 'text-right' : 'text-left';
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-3 align-top ${align} ${col.className ?? ''}`}
                      >
                        {col.render(row)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
