import type { ReactNode } from "react";

import { EmptyState } from "@/components/EmptyState";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
}

/**
 * The one table implementation.
 *
 * Sorting, filtering and server pagination arrive in Phase 4 with the file lists
 * that need them; the column contract is fixed now so no screen grows its own
 * bespoke table markup in the meantime.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: { title: string; description?: string };
}) {
  if (rows.length === 0) {
    return <EmptyState title={empty?.title ?? "Nothing to show"} {...(empty?.description ? { description: empty.description } : {})} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-lab-50 text-left text-xs uppercase tracking-wide text-slate-600">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-2 font-medium ${column.align === "right" ? "text-right" : ""}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-t border-lab-100 ${
                onRowClick ? "cursor-pointer hover:bg-lab-50" : ""
              }`}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-2 ${column.align === "right" ? "text-right" : ""}`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
