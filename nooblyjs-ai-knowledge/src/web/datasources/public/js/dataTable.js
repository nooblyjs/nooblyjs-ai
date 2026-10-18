/**
 * Data Table Component (Task 7.1.5)
 *
 * Flexible data table with:
 * - Sortable columns
 * - Pagination
 * - Row selection
 * - Custom cell renderers
 * - Empty state handling
 */

class DataTable {
  constructor(options = {}) {
    this.id = options.id || `table-${Date.now()}`;
    this.columns = options.columns || [];
    this.data = options.data || [];
    this.pageSize = options.pageSize || 10;
    this.currentPage = 1;
    this.sortColumn = options.sortColumn || null;
    this.sortDirection = 'asc';
    this.selectable = options.selectable !== false;
    this.selectedRows = new Set();
    this.onRowClick = options.onRowClick || (() => {});
    this.onSelectionChange = options.onSelectionChange || (() => {});
    this.emptyMessage = options.emptyMessage || 'No data available';
    this.element = null;
  }

  /**
   * Render table into container
   */
  render(container) {
    this.container = container;
    this.element = document.createElement('div');
    this.element.id = this.id;

    if (this.data.length === 0) {
      this.element.innerHTML = `
        <div class="alert alert-info text-center py-5">
          <i class="bi bi-info-circle" style="font-size: 28px;"></i>
          <p class="mt-3">${this.emptyMessage}</p>
        </div>
      `;
    } else {
      this.element.innerHTML = this.getTableHTML() + this.getPaginationHTML();
    }

    // Clear container and add table
    container.innerHTML = '';
    container.appendChild(this.element);

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Get table HTML
   */
  getTableHTML() {
    const { pageData, start, end } = this.getPaginatedData();

    const headerHTML = this.columns.map(col => `
      <th style="cursor: ${col.sortable ? 'pointer' : 'default'};"
          onclick="${col.sortable ? `this.parentElement.parentElement.parentElement.tableInstance.sort('${col.field}')` : ''}">
        ${col.label || col.field}
        ${this.sortColumn === col.field ? `
          <i class="bi ${this.sortDirection === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down'}" style="font-size: 10.5px;"></i>
        ` : ''}
      </th>
    `).join('');

    const bodyHTML = pageData.map((row, idx) => `
      <tr onclick="this.tableInstance.selectRow(${(this.currentPage - 1) * this.pageSize + idx}, event)"
          style="cursor: pointer;">
        ${this.selectable ? `
          <td style="width: 40px;">
            <input type="checkbox" class="form-check-input row-checkbox"
                   ${this.selectedRows.has(row) ? 'checked' : ''}
                   onchange="event.stopPropagation();">
          </td>
        ` : ''}
        ${this.columns.map(col => {
          let cellContent = row[col.field];

          if (col.render) {
            cellContent = col.render(row[col.field], row, col);
          } else if (col.type === 'date') {
            cellContent = new Date(cellContent).toLocaleString();
          } else if (col.type === 'boolean') {
            cellContent = cellContent ? '<i class="bi bi-check text-success"></i>' : '<i class="bi bi-x text-danger"></i>';
          }

          return `<td>${cellContent || '-'}</td>`;
        }).join('')}
      </tr>
    `).join('');

    return `
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              ${headerHTML}
            </tr>
          </thead>
          <tbody>
            ${bodyHTML}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Get pagination HTML
   */
  getPaginationHTML() {
    const totalPages = Math.ceil(this.data.length / this.pageSize);
    if (totalPages <= 1) return '';

    const pages = [];
    const maxButtons = 7;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    return `
      <nav class="mt-3">
        <ul class="pagination mb-0 justify-content-center">
          <li class="page-item ${this.currentPage === 1 ? 'disabled' : ''}">
            <button class="page-link" onclick="this.tableInstance.goToPage(1)">First</button>
          </li>
          ${Array.from({length: endPage - startPage + 1}, (_, i) => startPage + i).map(page => `
            <li class="page-item ${page === this.currentPage ? 'active' : ''}">
              <button class="page-link" onclick="this.tableInstance.goToPage(${page})">${page}</button>
            </li>
          `).join('')}
          <li class="page-item ${this.currentPage === totalPages ? 'disabled' : ''}">
            <button class="page-link" onclick="this.tableInstance.goToPage(${totalPages})">Last</button>
          </li>
        </ul>
      </nav>
    `;
  }

  /**
   * Get paginated data
   */
  getPaginatedData() {
    let sorted = [...this.data];

    // Sort
    if (this.sortColumn) {
      const col = this.columns.find(c => c.field === this.sortColumn);
      if (col) {
        sorted.sort((a, b) => {
          let aVal = a[this.sortColumn];
          let bVal = b[this.sortColumn];

          if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
          if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
          return 0;
        });
      }
    }

    // Paginate
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    const pageData = sorted.slice(start, end);

    return { pageData, sorted, start, end };
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const table = this.element.querySelector('table');
    if (table) {
      table.tableInstance = this;

      // Pagination buttons
      const pageLinks = this.element.querySelectorAll('.page-link');
      pageLinks.forEach(link => {
        link.tableInstance = this;
      });
    }
  }

  /**
   * Sort by column
   */
  sort(field) {
    const col = this.columns.find(c => c.field === field);
    if (!col || !col.sortable) return;

    if (this.sortColumn === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = field;
      this.sortDirection = 'asc';
    }

    this.currentPage = 1;
    this.render(this.container);
  }

  /**
   * Go to page
   */
  goToPage(page) {
    const totalPages = Math.ceil(this.data.length / this.pageSize);
    if (page >= 1 && page <= totalPages) {
      this.currentPage = page;
      this.render(this.container);
    }
  }

  /**
   * Select row
   */
  selectRow(index, event) {
    if (!this.selectable) return;

    const { pageData } = this.getPaginatedData();
    const row = pageData[index];

    if (event && event.target.type === 'checkbox') {
      this.selectedRows.has(row) ? this.selectedRows.delete(row) : this.selectedRows.add(row);
    } else if (event && event.target.tagName !== 'INPUT') {
      this.onRowClick(row);
    }

    this.onSelectionChange(Array.from(this.selectedRows));
    this.render(this.container);
  }

  /**
   * Get selected rows
   */
  getSelectedRows() {
    return Array.from(this.selectedRows);
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.selectedRows.clear();
    this.onSelectionChange([]);
    if (this.container && this.element) {
      const checkboxes = this.element.querySelectorAll('.row-checkbox');
      checkboxes.forEach(cb => cb.checked = false);
    }
  }

  /**
   * Select all visible rows
   */
  selectAll() {
    const { pageData } = this.getPaginatedData();
    pageData.forEach(row => this.selectedRows.add(row));
    this.onSelectionChange(Array.from(this.selectedRows));
    this.render(this.container);
  }

  /**
   * Update data
   */
  setData(data) {
    this.data = data;
    this.currentPage = 1;
    this.selectedRows.clear();
    this.render(this.container);
  }

  /**
   * Add row
   */
  addRow(row) {
    this.data.push(row);
    this.render(this.container);
  }

  /**
   * Remove row
   */
  removeRow(predicate) {
    this.data = this.data.filter(row => !predicate(row));
    this.render(this.container);
  }

  /**
   * Update row
   */
  updateRow(predicate, updates) {
    this.data = this.data.map(row => {
      if (predicate(row)) {
        return { ...row, ...updates };
      }
      return row;
    });
    this.render(this.container);
  }
}

/**
 * Convenience function: Create and render table
 */
function createDataTable(options = {}) {
  const table = new DataTable(options);

  if (options.container) {
    table.render(options.container);
  }

  return table;
}
