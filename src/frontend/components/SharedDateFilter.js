/**
 * components/SharedDateFilter.js — Shared Date Range Picker Component
 * 
 * Reusable vanilla JavaScript component for selecting date ranges.
 * Fully responsive (Desktop popover, Mobile bottom sheet).
 * Synchronizes state via LocalStorage across multiple instances.
 */

window.SharedDateRangePicker = (function() {
    // Shared Date Helper: Format Date as YYYY-MM-DD
    const formatDateInput = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Shared Date Helper: Format Date in Indonesian (e.g., 14 Jul 2026)
    const formatIndonesianDate = (dateStr) => {
        if (!dateStr) return "";
        const parts = dateStr.split("-");
        if (parts.length !== 3) return dateStr;
        const year = parts[0];
        const monthIndex = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);
        const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
        return `${day} ${months[monthIndex]} ${year}`;
    };

    class DateRangePicker {
        constructor({ containerId, onChange, storageKey }) {
            this.container = document.getElementById(containerId);
            if (!this.container) {
                console.warn(`Container with ID "${containerId}" not found for DateRangePicker`);
                return;
            }
            this.onChange = onChange;
            this.storageKey = storageKey || 'ansla_global_date_filter_state';

            // Bind methods to this instance
            this.toggleDatePicker = this.toggleDatePicker.bind(this);
            this.closeDatePicker = this.closeDatePicker.bind(this);
            this.closeDatePickerOnClickOutside = this.closeDatePickerOnClickOutside.bind(this);
            this.handleWindowActivity = () => {
                if (this.popover && !this.popover.classList.contains("hidden")) {
                    this.positionPopover();
                }
            };

            // Load initial state
            this.state = this.loadState();

            // Render DOM structure
            this.renderStructure();

            // Query elements
            this.triggerBtn = this.container.querySelector('.dp-trigger');
            this.label = this.container.querySelector('.dp-label');
            
            // Query elements from popover
            this.content = this.popover.querySelector('.dp-content');
            this.quickBtns = this.popover.querySelectorAll('.dp-quick-btn');
            this.tabs = this.popover.querySelectorAll('.dp-tab');

            // Initialize Event Listeners
            this.initEvents();

            // Initial UI Update
            this.updateUI();
        }

        loadState() {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                try {
                    return JSON.parse(stored);
                } catch (e) {
                    console.warn("Failed to parse stored DateRangePicker state, using defaults");
                }
            }

            // Defaults: Last 7 Days
            const now = new Date();
            const start = new Date();
            start.setDate(now.getDate() - 6);

            return {
                activePeriod: "7days",
                activeDateFrom: formatDateInput(start),
                activeDateTo: formatDateInput(now),
                activePeriodLabel: "7 Hari Terakhir",
                activeDpMode: "day",
                pickerMonth: now.getMonth(),
                pickerYear: now.getFullYear(),
                customStart: null,
                customEnd: null
            };
        }

        saveState() {
            localStorage.setItem(this.storageKey, JSON.stringify(this.state));
        }

        syncState() {
            const latest = this.loadState();
            if (latest.activeDateFrom !== this.state.activeDateFrom || 
                latest.activeDateTo !== this.state.activeDateTo || 
                latest.activePeriod !== this.state.activePeriod) {
                
                this.state = latest;
                this.updateUI();
                if (this.onChange) {
                    this.onChange(this.state.activeDateFrom, this.state.activeDateTo, this.state.activePeriod, this.state.activePeriodLabel);
                }
            }
        }

        getDateRange() {
            return {
                dateFrom: this.state.activeDateFrom,
                dateTo: this.state.activeDateTo,
                period: this.state.activePeriod,
                label: this.state.activePeriodLabel
            };
        }

        renderStructure() {
            this.container.className = "relative inline-block text-left w-full sm:w-auto";
            this.container.innerHTML = `
                <button type="button" class="dp-trigger ds-btn border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 py-1.5 px-3 flex items-center gap-2 text-xs rounded-xl shadow-sm transition w-full min-w-[200px] justify-between">
                    <span class="flex items-center gap-1.5">
                        <i class="ph ph-calendar text-indigo-600 text-sm"></i>
                        <span class="dp-label">7 Hari Terakhir</span>
                    </span>
                    <i class="ph ph-caret-down text-gray-400"></i>
                </button>
            `;
            
            // Create popover and append directly to body (Portal pattern to prevent clipping)
            this.popover = document.createElement('div');
            this.popover.className = "dp-popover ba-datepicker-popover hidden absolute bg-white rounded-2xl border border-gray-100 shadow-xl z-[9999] p-4 flex gap-4 text-xs font-sans transition-all duration-150 transform scale-95 opacity-0";
            this.popover.innerHTML = `
                <!-- Left Sidebar (Quick Filters) -->
                <div class="w-1/3 flex flex-col gap-1.5 border-r border-gray-100 pr-3 flex-shrink-0">
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Filter Cepat</span>
                    <button type="button" data-filter="today" class="dp-quick-btn text-left py-1.5 px-2.5 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 font-semibold transition text-gray-600">Hari Ini</button>
                    <button type="button" data-filter="yesterday" class="dp-quick-btn text-left py-1.5 px-2.5 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 font-semibold transition text-gray-600">Kemarin</button>
                    <button type="button" data-filter="7days" class="dp-quick-btn text-left py-1.5 px-2.5 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 font-semibold transition text-gray-600">7 Hari Terakhir</button>
                    <button type="button" data-filter="30days" class="dp-quick-btn text-left py-1.5 px-2.5 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 font-semibold transition text-gray-600">30 Hari Terakhir</button>
                    <button type="button" data-filter="90days" class="dp-quick-btn text-left py-1.5 px-2.5 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 font-semibold transition text-gray-600">90 Hari Terakhir</button>
                </div>
                
                <!-- Right Workspace -->
                <div class="flex-1 flex flex-col gap-3 min-w-0">
                    <!-- Mode Tabs -->
                    <div class="flex border-b border-gray-100 pb-1.5 gap-2 overflow-x-auto select-none">
                        <button type="button" data-mode="day" class="dp-tab pb-1 font-bold text-gray-400 hover:text-gray-600 whitespace-nowrap">Hari</button>
                        <button type="button" data-mode="week" class="dp-tab pb-1 font-bold text-gray-400 hover:text-gray-600 whitespace-nowrap">Minggu</button>
                        <button type="button" data-mode="month" class="dp-tab pb-1 font-bold text-gray-400 hover:text-gray-600 whitespace-nowrap">Bulan</button>
                        <button type="button" data-mode="year" class="dp-tab pb-1 font-bold text-gray-400 hover:text-gray-600 whitespace-nowrap">Tahun</button>
                        <button type="button" data-mode="custom" class="dp-tab pb-1 font-bold text-gray-400 hover:text-gray-600 whitespace-nowrap">Kustom</button>
                    </div>
                    
                    <!-- Content -->
                    <div class="dp-content min-h-[220px]">
                        <!-- Dinamis -->
                    </div>
                </div>
            `;
            document.body.appendChild(this.popover);
        }

        initEvents() {
            // Toggle Popover
            this.triggerBtn.addEventListener('click', this.toggleDatePicker);

            // Quick Filters
            this.quickBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const filter = e.target.getAttribute('data-filter');
                    this.selectQuickFilter(filter);
                });
            });

            // Tabs
            this.tabs.forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const mode = e.target.getAttribute('data-mode');
                    this.setDatePickerMode(mode);
                });
            });
        }

        toggleDatePicker(event) {
            if (event) event.stopPropagation();
            const isHidden = this.popover.classList.contains("hidden");
            if (isHidden) {
                // Sembunyikan popup datepicker lain yang mungkin terbuka di viewport
                document.querySelectorAll('.dp-popover').forEach(p => {
                    p.classList.remove("show");
                    p.classList.add("hidden");
                });

                this.popover.classList.remove("hidden");
                this.positionPopover();

                setTimeout(() => {
                    this.popover.classList.add("show");
                }, 10);
                this.renderDatePicker();
                document.addEventListener("click", this.closeDatePickerOnClickOutside);
                window.addEventListener('resize', this.handleWindowActivity);
                window.addEventListener('scroll', this.handleWindowActivity, true);
            } else {
                this.closeDatePicker();
            }
        }

        closeDatePicker() {
            if (!this.popover) return;
            this.popover.classList.remove("show");
            setTimeout(() => {
                if (this.popover) this.popover.classList.add("hidden");
            }, 150);
            document.removeEventListener("click", this.closeDatePickerOnClickOutside);
            window.removeEventListener('resize', this.handleWindowActivity);
            window.removeEventListener('scroll', this.handleWindowActivity, true);
        }

        closeDatePickerOnClickOutside(e) {
            if (this.container && !this.container.contains(e.target) &&
                this.popover && !this.popover.contains(e.target)) {
                this.closeDatePicker();
            }
        }

        positionPopover() {
            if (!this.popover || !this.triggerBtn) return;

            if (window.innerWidth <= 640) {
                // Mobile layout: Bottom Sheet (managed by CSS media query in index.html)
                // We clear desktop inline positioning styles so media queries take effect
                this.popover.style.position = '';
                this.popover.style.top = '';
                this.popover.style.left = '';
                this.popover.style.right = '';
                this.popover.style.bottom = '';
                this.popover.style.width = '';
                this.popover.style.transform = '';
                return;
            }

            // Desktop/Tablet layout: absolute positioning right under the trigger button
            const rect = this.triggerBtn.getBoundingClientRect();
            const popoverWidth = 480;
            const popoverHeight = 295; // height of popover (approx 280-310px depending on tab)
            
            let top = rect.bottom + window.scrollY + 8;
            let left = rect.right + window.scrollX - popoverWidth;

            // Check left boundary constraint
            if (left < window.scrollX) {
                left = rect.left + window.scrollX;
            }

            // Check right boundary constraint
            if (left + popoverWidth > window.innerWidth + window.scrollX) {
                left = window.innerWidth + window.scrollX - popoverWidth - 10;
            }

            // Check bottom boundary constraint: if it overflows the viewport height, place it above the trigger
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < popoverHeight && rect.top > popoverHeight) {
                top = rect.top + window.scrollY - popoverHeight - 8;
            }

            this.popover.style.position = 'absolute';
            this.popover.style.top = `${top}px`;
            this.popover.style.left = `${left}px`;
            this.popover.style.right = 'auto';
            this.popover.style.bottom = 'auto';
            this.popover.style.width = `${popoverWidth}px`;
            this.popover.style.transform = 'scale(1)'; // overrides scale-95 transform rule
        }

        selectQuickFilter(filter) {
            const now = new Date();
            let dateFrom = new Date();
            let dateTo = new Date();
            let label = "";

            if (filter === "today") {
                label = "Hari Ini";
            } else if (filter === "yesterday") {
                dateFrom.setDate(now.getDate() - 1);
                dateTo.setDate(now.getDate() - 1);
                label = "Kemarin";
            } else if (filter === "7days") {
                dateFrom.setDate(now.getDate() - 6);
                label = "7 Hari Terakhir";
            } else if (filter === "30days") {
                dateFrom.setDate(now.getDate() - 29);
                label = "30 Hari Terakhir";
            } else if (filter === "90days") {
                dateFrom.setDate(now.getDate() - 89);
                label = "90 Hari Terakhir";
            }

            this.state.activePeriod = filter;
            this.state.activeDateFrom = formatDateInput(dateFrom);
            this.state.activeDateTo = formatDateInput(dateTo);
            this.state.activePeriodLabel = label;

            this.saveState();
            this.updateUI();
            this.closeDatePicker();

            // Panggil callback perubahan
            if (this.onChange) {
                this.onChange(this.state.activeDateFrom, this.state.activeDateTo, this.state.activePeriod, this.state.activePeriodLabel);
            }
        }

        setDatePickerMode(mode) {
            this.state.activeDpMode = mode;
            this.renderDatePicker();
        }

        renderDatePicker() {
            // Update active state of Tabs
            this.tabs.forEach(tab => {
                const mode = tab.getAttribute('data-mode');
                if (mode === this.state.activeDpMode) {
                    tab.className = "dp-tab pb-1 font-bold text-indigo-600 border-b-2 border-indigo-600 whitespace-nowrap";
                } else {
                    tab.className = "dp-tab pb-1 font-bold text-gray-400 hover:text-gray-600 whitespace-nowrap";
                }
            });

            // Update active state of Quick Filter buttons
            this.quickBtns.forEach(btn => {
                const filter = btn.getAttribute('data-filter');
                if (filter === this.state.activePeriod) {
                    btn.classList.add("active", "bg-indigo-50", "text-indigo-600");
                } else {
                    btn.classList.remove("active", "bg-indigo-50", "text-indigo-600");
                }
            });

            if (!this.content) return;

            const mode = this.state.activeDpMode;

            if (mode === "day" || mode === "week" || mode === "custom") {
                const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
                
                let calendarHtml = `
                    <div class="flex items-center justify-between mb-3 select-none">
                        <button type="button" class="dp-prev-month-btn p-1 hover:bg-gray-100 rounded-lg text-gray-500"><i class="ph ph-caret-left font-bold"></i></button>
                        <span class="font-bold text-gray-800">${monthNames[this.state.pickerMonth]} ${this.state.pickerYear}</span>
                        <button type="button" class="dp-next-month-btn p-1 hover:bg-gray-100 rounded-lg text-gray-500"><i class="ph ph-caret-right font-bold"></i></button>
                    </div>
                    <div class="ba-dp-calendar-grid mb-1 text-[10px] font-bold text-gray-400 select-none">
                        <span>Min</span><span>Sen</span><span>Sel</span><span>Rab</span><span>Kam</span><span>Jum</span><span>Sab</span>
                    </div>
                    <div class="ba-dp-calendar-grid">
                `;

                const firstDay = new Date(this.state.pickerYear, this.state.pickerMonth, 1).getDay();
                const totalDays = new Date(this.state.pickerYear, this.state.pickerMonth + 1, 0).getDate();
                const today = new Date();

                for (let i = 0; i < firstDay; i++) {
                    calendarHtml += `<span class="ba-dp-cell empty"></span>`;
                }

                for (let d = 1; d <= totalDays; d++) {
                    const cellDate = new Date(this.state.pickerYear, this.state.pickerMonth, d);
                    const cellDateStr = formatDateInput(cellDate);
                    
                    let classes = "ba-dp-cell font-semibold text-gray-700 text-[11px]";

                    if (mode === "day") {
                        if (cellDateStr === this.state.activeDateFrom && cellDateStr === this.state.activeDateTo) {
                            classes += " selected";
                        }
                    } else if (mode === "week") {
                        if (this.state.activeDateFrom && this.state.activeDateTo) {
                            const df = new Date(this.state.activeDateFrom + "T00:00:00");
                            const dt = new Date(this.state.activeDateTo + "T00:00:00");
                            if (cellDate >= df && cellDate <= dt) {
                                classes += " selected";
                            }
                        }
                    } else if (mode === "custom") {
                        if (this.state.customStart && cellDateStr === this.state.customStart) {
                            classes += " selected";
                        } else if (this.state.customEnd && cellDateStr === this.state.customEnd) {
                            classes += " selected";
                        } else if (this.state.customStart && this.state.customEnd) {
                            const ds = new Date(this.state.customStart + "T00:00:00");
                            const de = new Date(this.state.customEnd + "T00:00:00");
                            if (cellDate > ds && cellDate < de) {
                                classes += " range-mid";
                            }
                        }
                    }

                    if (cellDate.toDateString() === today.toDateString()) {
                        classes += " today";
                    }

                    calendarHtml += `<span data-date="${cellDateStr}" class="${classes}">${d}</span>`;
                }

                calendarHtml += `</div>`;

                if (mode === "custom") {
                    calendarHtml += `
                        <div class="flex justify-end gap-2 border-t pt-2.5 mt-2.5">
                            <button type="button" class="dp-apply-custom-btn ds-btn ds-btn-primary px-3 py-1.5 text-[10px] rounded-lg">Terapkan</button>
                        </div>
                    `;
                }
                
                this.content.innerHTML = calendarHtml;

                // Bind calendar action buttons
                this.content.querySelector('.dp-prev-month-btn').addEventListener('click', () => this.prevMonth());
                this.content.querySelector('.dp-next-month-btn').addEventListener('click', () => this.nextMonth());

                // Bind click events on calendar cells
                this.content.querySelectorAll('.ba-dp-cell:not(.empty)').forEach(cell => {
                    cell.addEventListener('click', (e) => {
                        const dateStr = e.target.getAttribute('data-date');
                        if (mode === "day") {
                            this.onSelectDate(dateStr);
                        } else if (mode === "week") {
                            this.onSelectWeek(dateStr);
                        } else if (mode === "custom") {
                            this.onSelectCustomRange(dateStr);
                        }
                    });
                });

                if (mode === "custom") {
                    this.content.querySelector('.dp-apply-custom-btn').addEventListener('click', () => this.applyCustomRange());
                }

            } else if (mode === "month") {
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
                let monthHtml = `
                    <div class="flex items-center justify-between mb-3 select-none">
                        <button type="button" class="dp-prev-year-btn p-1 hover:bg-gray-100 rounded-lg text-gray-500"><i class="ph ph-caret-left font-bold"></i></button>
                        <span class="font-bold text-gray-800">${this.state.pickerYear}</span>
                        <button type="button" class="dp-next-year-btn p-1 hover:bg-gray-100 rounded-lg text-gray-500"><i class="ph ph-caret-right font-bold"></i></button>
                    </div>
                    <div class="ba-dp-month-grid">
                `;
                
                for (let m = 0; m < 12; m++) {
                    let classes = "ba-dp-month-cell text-gray-700 font-semibold text-[11px] py-2";
                    const startOfMonthStr = formatDateInput(new Date(this.state.pickerYear, m, 1));
                    const endOfMonthStr = formatDateInput(new Date(this.state.pickerYear, m + 1, 0));
                    
                    if (this.state.activeDateFrom === startOfMonthStr && this.state.activeDateTo === endOfMonthStr) {
                        classes += " selected";
                    }
                    
                    monthHtml += `<span data-month="${m}" class="${classes}">${monthNames[m]}</span>`;
                }
                monthHtml += `</div>`;
                this.content.innerHTML = monthHtml;

                // Bind years navigations
                this.content.querySelector('.dp-prev-year-btn').addEventListener('click', () => this.prevYear());
                this.content.querySelector('.dp-next-year-btn').addEventListener('click', () => this.nextYear());

                // Bind click events on month cells
                this.content.querySelectorAll('.ba-dp-month-cell').forEach(cell => {
                    cell.addEventListener('click', (e) => {
                        const m = parseInt(e.target.getAttribute('data-month'));
                        this.onSelectMonth(m, this.state.pickerYear);
                    });
                });

            } else if (mode === "year") {
                let yearHtml = `<div class="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1">`;
                const currentYear = new Date().getFullYear();
                
                for (let y = currentYear; y >= currentYear - 5; y--) {
                    let classes = "ba-dp-month-cell text-gray-700 font-semibold text-[11px] text-center w-full block py-2";
                    const startOfYearStr = formatDateInput(new Date(y, 0, 1));
                    const endOfYearStr = formatDateInput(new Date(y, 11, 31));
                    
                    if (this.state.activeDateFrom === startOfYearStr && this.state.activeDateTo === endOfYearStr) {
                        classes += " selected";
                    }
                    
                    yearHtml += `<span data-year="${y}" class="${classes}">${y}</span>`;
                }
                yearHtml += `</div>`;
                this.content.innerHTML = yearHtml;

                // Bind click events on year cells
                this.content.querySelectorAll('.ba-dp-month-cell').forEach(cell => {
                    cell.addEventListener('click', (e) => {
                        const y = parseInt(e.target.getAttribute('data-year'));
                        this.onSelectYear(y);
                    });
                });
            }
        }

        prevMonth() {
            if (this.state.pickerMonth === 0) {
                this.state.pickerMonth = 11;
                this.state.pickerYear--;
            } else {
                this.state.pickerMonth--;
            }
            this.renderDatePicker();
        }

        nextMonth() {
            if (this.state.pickerMonth === 11) {
                this.state.pickerMonth = 0;
                this.state.pickerYear++;
            } else {
                this.state.pickerMonth++;
            }
            this.renderDatePicker();
        }

        prevYear() {
            this.state.pickerYear--;
            this.renderDatePicker();
        }

        nextYear() {
            this.state.pickerYear++;
            this.renderDatePicker();
        }

        onSelectDate(dateStr) {
            this.state.activePeriod = "custom";
            this.state.activeDateFrom = dateStr;
            this.state.activeDateTo = dateStr;
            this.state.activePeriodLabel = formatIndonesianDate(dateStr);
            
            this.saveState();
            this.updateUI();
            this.closeDatePicker();

            if (this.onChange) {
                this.onChange(this.state.activeDateFrom, this.state.activeDateTo, this.state.activePeriod, this.state.activePeriodLabel);
            }
        }

        onSelectWeek(dateStr) {
            const date = new Date(dateStr + "T12:00:00");
            const dayOfWeek = date.getDay();
            const mondayDiff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            const monday = new Date(date);
            monday.setDate(date.getDate() + mondayDiff);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            
            this.state.activePeriod = "custom";
            this.state.activeDateFrom = formatDateInput(monday);
            this.state.activeDateTo = formatDateInput(sunday);
            this.state.activePeriodLabel = `${formatIndonesianDate(this.state.activeDateFrom)} — ${formatIndonesianDate(this.state.activeDateTo)}`;
            
            this.saveState();
            this.updateUI();
            this.closeDatePicker();

            if (this.onChange) {
                this.onChange(this.state.activeDateFrom, this.state.activeDateTo, this.state.activePeriod, this.state.activePeriodLabel);
            }
        }

        onSelectMonth(month, year) {
            const start = new Date(year, month, 1);
            const end = new Date(year, month + 1, 0);
            
            this.state.activePeriod = "custom";
            this.state.activeDateFrom = formatDateInput(start);
            this.state.activeDateTo = formatDateInput(end);
            
            const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
            this.state.activePeriodLabel = `${monthNames[month]} ${year}`;
            
            this.saveState();
            this.updateUI();
            this.closeDatePicker();

            if (this.onChange) {
                this.onChange(this.state.activeDateFrom, this.state.activeDateTo, this.state.activePeriod, this.state.activePeriodLabel);
            }
        }

        onSelectYear(year) {
            const start = new Date(year, 0, 1);
            const end = new Date(year, 11, 31);
            
            this.state.activePeriod = "custom";
            this.state.activeDateFrom = formatDateInput(start);
            this.state.activeDateTo = formatDateInput(end);
            this.state.activePeriodLabel = `Tahun ${year}`;
            
            this.saveState();
            this.updateUI();
            this.closeDatePicker();

            if (this.onChange) {
                this.onChange(this.state.activeDateFrom, this.state.activeDateTo, this.state.activePeriod, this.state.activePeriodLabel);
            }
        }

        onSelectCustomRange(dateStr) {
            if (!this.state.customStart || (this.state.customStart && this.state.customEnd)) {
                this.state.customStart = dateStr;
                this.state.customEnd = null;
            } else {
                if (dateStr < this.state.customStart) {
                    this.state.customStart = dateStr;
                } else {
                    this.state.customEnd = dateStr;
                }
            }
            this.renderDatePicker();
        }

        applyCustomRange() {
            if (!this.state.customStart || !this.state.customEnd) {
                if (typeof showToast === 'function') {
                    showToast("Pilih tanggal awal dan akhir.", "error");
                } else {
                    alert("Pilih tanggal awal dan akhir.");
                }
                return;
            }
            this.state.activePeriod = "custom";
            this.state.activeDateFrom = this.state.customStart;
            this.state.activeDateTo = this.state.customEnd;
            this.state.activePeriodLabel = `${formatIndonesianDate(this.state.customStart)} — ${formatIndonesianDate(this.state.customEnd)}`;
            
            this.saveState();
            this.updateUI();
            this.closeDatePicker();

            if (this.onChange) {
                this.onChange(this.state.activeDateFrom, this.state.activeDateTo, this.state.activePeriod, this.state.activePeriodLabel);
            }
        }

        updateUI() {
            if (this.label) {
                this.label.textContent = this.state.activePeriodLabel;
            }
            
            // Sync quick filter buttons styling
            this.quickBtns.forEach(btn => {
                const filter = btn.getAttribute('data-filter');
                if (filter === this.state.activePeriod) {
                    btn.classList.add("active", "bg-indigo-50", "text-indigo-600");
                } else {
                    btn.classList.remove("active", "bg-indigo-50", "text-indigo-600");
                }
            });
        }
    }

    return DateRangePicker;
})();
