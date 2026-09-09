// ============================================================
// BusinessAnalytics/shared/ba-shared.js — BI Shared Utilities & SVG Charts
// ============================================================

const BusinessAnalyticsShared = {
    /**
     * Format angka ke Rupiah.
     */
    formatCurrency(value) {
        const val = parseFloat(value) || 0;
        return new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    },

    /**
     * Format persen.
     */
    formatPercent(value) {
        const val = parseFloat(value) || 0;
        return val.toFixed(1) + "%";
    },

    /**
     * Format angka desimal.
     */
    formatNumber(value) {
        const val = parseFloat(value) || 0;
        return new Intl.NumberFormat("id-ID").format(val);
    },

    /**
     * Membuat Grafik Line/Area SVG yang responsif dengan gradien premium.
     */
    createSvgAreaChart(containerId, data, labels) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = "";

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-gray-400">Tidak ada data untuk grafik.</div>`;
            return;
        }

        const width = container.clientWidth || 500;
        const height = container.clientHeight || 200;
        const paddingLeft = 60;
        const paddingRight = 20;
        const paddingTop = 20;
        const paddingBottom = 30;

        const maxVal = Math.max(...data) * 1.1 || 10;
        const minVal = 0;
        const range = maxVal - minVal;

        const chartWidth = width - paddingLeft - paddingRight;
        const chartHeight = height - paddingTop - paddingBottom;

        // Generate SVG
        let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" class="overflow-visible font-sans text-[10px] text-gray-500">`;
        
        // Definisikan Gradien & Shadow
        svg += `
            <defs>
                <linearGradient id="chartGrad-${containerId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.3"/>
                    <stop offset="100%" stop-color="#4f46e5" stop-opacity="0"/>
                </linearGradient>
            </defs>
        `;

        // Gambar Grid Lines Y & Label Y
        const yGridCount = 4;
        for (let i = 0; i <= yGridCount; i++) {
            const val = minVal + (range * i) / yGridCount;
            const y = height - paddingBottom - (chartHeight * i) / yGridCount;
            // Grid Line
            svg += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#f1f5f9" stroke-width="1" />`;
            // Label Y
            svg += `<text x="${paddingLeft - 10}" y="${y + 3}" text-anchor="end" fill="#94a3b8">${this.formatCompact(val)}</text>`;
        }

        // Hitung Koordinat Poin
        const points = [];
        const xStep = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
        
        data.forEach((val, i) => {
            const x = paddingLeft + i * xStep;
            const y = height - paddingBottom - (chartHeight * (val - minVal)) / range;
            points.push({ x, y, val, label: labels[i] || "" });
        });

        // Buat Path Area (di bawah garis utama)
        if (points.length > 0) {
            let areaPath = `M ${points[0].x} ${height - paddingBottom}`;
            points.forEach(p => {
                areaPath += ` L ${p.x} ${p.y}`;
            });
            areaPath += ` L ${points[points.length - 1].x} ${height - paddingBottom} Z`;
            svg += `<path d="${areaPath}" fill="url(#chartGrad-${containerId})" />`;
        }

        // Buat Path Line (Garis utama)
        if (points.length > 0) {
            let linePath = `M ${points[0].x} ${points[0].y}`;
            for (let i = 1; i < points.length; i++) {
                linePath += ` L ${points[i].x} ${points[i].y}`;
            }
            svg += `<path d="${linePath}" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
        }

        // Render Dots, Hover Zones & Label X
        const maxLabels = 6;
        const xLabelInterval = Math.max(1, Math.ceil(data.length / maxLabels));
        points.forEach((p, i) => {
            // Label X
            if (i % xLabelInterval === 0) {
                svg += `<text x="${p.x}" y="${height - 10}" text-anchor="middle" fill="#94a3b8">${p.label}</text>`;
            }

            // Dot marker
            svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#FFFFFF" stroke="#4f46e5" stroke-width="2" class="cursor-pointer transition-all duration-150 hover:r-5" id="dot-${containerId}-${i}">`;
            svg += `<title>${p.label}: ${this.formatCurrency(p.val)}</title>`;
            svg += `</circle>`;
        });

        svg += `</svg>`;
        container.innerHTML = svg;
    },

    /**
     * Membuat Grafik Batang (Bar Chart) SVG yang responsif.
     */
    createSvgBarChart(containerId, data, labels) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = "";

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-gray-400">Tidak ada data untuk grafik.</div>`;
            return;
        }

        const width = container.clientWidth || 500;
        const height = container.clientHeight || 200;
        const paddingLeft = 50;
        const paddingRight = 20;
        const paddingTop = 20;
        const paddingBottom = 30;

        const maxVal = Math.max(...data) * 1.1 || 10;
        const minVal = 0;
        const range = maxVal - minVal;

        const chartWidth = width - paddingLeft - paddingRight;
        const chartHeight = height - paddingTop - paddingBottom;

        // Generate SVG
        let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" class="overflow-visible font-sans text-[10px] text-gray-500">`;

        // Gambar Grid Lines Y & Label Y
        const yGridCount = 4;
        for (let i = 0; i <= yGridCount; i++) {
            const val = minVal + (range * i) / yGridCount;
            const y = height - paddingBottom - (chartHeight * i) / yGridCount;
            // Grid Line
            svg += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#f1f5f9" stroke-width="1" />`;
            // Label Y
            svg += `<text x="${paddingLeft - 10}" y="${y + 3}" text-anchor="end" fill="#94a3b8">${this.formatNumber(val)}</text>`;
        }

        const barCount = data.length;
        const totalBarSpacingRatio = 0.4; // 40% spacing
        const barWidth = (chartWidth / barCount) * (1 - totalBarSpacingRatio);
        const barSpacing = (chartWidth / barCount) * totalBarSpacingRatio;

        data.forEach((val, i) => {
            const x = paddingLeft + (i * (barWidth + barSpacing)) + (barSpacing / 2);
            const barHeight = (chartHeight * (val - minVal)) / range;
            const y = height - paddingBottom - barHeight;

            // Gambar Bar dengan rounded top (menggunakan path atau rect)
            svg += `
                <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#6366f1" rx="4" ry="4" class="cursor-pointer transition-all duration-150 hover:fill-indigo-700">
                    <title>${labels[i]}: ${this.formatNumber(val)}</title>
                </rect>
            `;

            // Label X (Tampilkan hanya jika kelipatan interval agar tidak tumpang tindih)
            const maxLabels = 6;
            const xLabelInterval = Math.max(1, Math.ceil(barCount / maxLabels));
            if (i % xLabelInterval === 0) {
                svg += `<text x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" fill="#94a3b8">${labels[i]}</text>`;
            }
            
            // Value di atas bar (jika tidak terlalu padat)
            if (barCount <= 15 && val > 0) {
                svg += `<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" font-weight="bold" fill="#475569">${this.formatNumber(val)}</text>`;
            }
        });

        svg += `</svg>`;
        container.innerHTML = svg;
    },

    /**
     * Memformat angka besar menjadi format compact (misal: 1.5M, 20K)
     */
    formatCompact(value) {
        const val = parseFloat(value) || 0;
        if (val >= 1e9) {
            return (val / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
        }
        if (val >= 1e6) {
            return (val / 1e6).toFixed(1).replace(/\.0$/, "") + "Jt";
        }
        if (val >= 1e3) {
            return (val / 1e3).toFixed(1).replace(/\.0$/, "") + "Rb";
        }
        return val.toString();
    },

    /**
     * Membuat Grafik Garis (Line Chart) SVG yang responsif.
     */
    createSvgLineChart(containerId, data, labels) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = "";
        
        if (!data || data.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-gray-400">Tidak ada data untuk grafik.</div>`;
            return;
        }

        const width = container.clientWidth || 500;
        const height = container.clientHeight || 200;
        const paddingLeft = 50;
        const paddingRight = 20;
        const paddingTop = 20;
        const paddingBottom = 30;

        const maxVal = Math.max(...data) * 1.1 || 10;
        const minVal = 0;
        const range = maxVal - minVal;

        const chartWidth = width - paddingLeft - paddingRight;
        const chartHeight = height - paddingTop - paddingBottom;

        let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" class="overflow-visible font-sans text-[10px] text-gray-500">`;

        // Grid lines Y
        const yGridCount = 4;
        for (let i = 0; i <= yGridCount; i++) {
            const val = minVal + (range * i) / yGridCount;
            const y = height - paddingBottom - (chartHeight * i) / yGridCount;
            svg += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#f1f5f9" stroke-width="1" />`;
            svg += `<text x="${paddingLeft - 10}" y="${y + 3}" text-anchor="end" fill="#94a3b8">${this.formatNumber(val)}</text>`;
        }

        const points = [];
        const xStep = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
        data.forEach((val, i) => {
            const x = paddingLeft + i * xStep;
            const y = height - paddingBottom - (chartHeight * (val - minVal)) / range;
            points.push({ x, y, val, label: labels[i] || "" });
        });

        // Main line path
        if (points.length > 0) {
            let linePath = `M ${points[0].x} ${points[0].y}`;
            for (let i = 1; i < points.length; i++) {
                linePath += ` L ${points[i].x} ${points[i].y}`;
            }
            svg += `<path d="${linePath}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
        }

        // Render markers & labels
        const maxLabels = 6;
        const xLabelInterval = Math.max(1, Math.ceil(data.length / maxLabels));
        points.forEach((p, i) => {
            if (i % xLabelInterval === 0) {
                svg += `<text x="${p.x}" y="${height - 10}" text-anchor="middle" fill="#94a3b8">${p.label}</text>`;
            }
            svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#FFFFFF" stroke="#f59e0b" stroke-width="2" class="cursor-pointer">`;
            svg += `<title>${p.label}: ${this.formatNumber(p.val)}</title>`;
            svg += `</circle>`;
        });

        svg += `</svg>`;
        container.innerHTML = svg;
    },

    /**
     * Membuat Grafik Donat (Donut Chart) SVG yang responsif dengan legenda di sebelah kanan.
     */
    createSvgDonutChart(containerId, data, labels) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = "";

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-gray-400">Tidak ada data untuk grafik.</div>`;
            return;
        }

        const width = container.clientWidth || 300;
        const height = container.clientHeight || 200;
        const size = Math.min(width, height) - 40;
        const radius = size / 2 - 15;
        const cx = width / 2 - 50; // Offset ke kiri untuk memberi ruang legenda
        const cy = height / 2;

        const total = data.reduce((acc, val) => acc + val, 0);
        if (total === 0) {
            container.innerHTML = `<div class="h-full flex items-center justify-center text-xs text-gray-400">Total data kosong.</div>`;
            return;
        }

        const colors = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#64748b"];

        let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" class="overflow-visible font-sans text-xs text-gray-500">`;

        let cumulativePercent = 0;

        // Gambar segmen donat
        data.forEach((val, i) => {
            const percent = val / total;
            if (percent === 0) return;
            
            const strokeDash = 2 * Math.PI * radius;
            const strokeOffset = strokeDash * (1 - percent);
            const rotation = cumulativePercent * 360 - 90; // Rotasi 90deg agar mulai dari atas

            svg += `
                <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${colors[i % colors.length]}" 
                        stroke-width="14" stroke-dasharray="${strokeDash}" stroke-dashoffset="${strokeOffset}"
                        transform="rotate(${rotation} ${cx} ${cy})" class="cursor-pointer transition-all duration-150 hover:stroke-width-[18]">
                    <title>${labels[i]}: ${val} (${(percent*100).toFixed(1)}%)</title>
                </circle>
            `;

            cumulativePercent += percent;
        });

        // Lingkaran tengah putih agar menjadi donat
        svg += `<circle cx="${cx}" cy="${cy}" r="${radius - 7}" fill="#FFFFFF" class="dark:fill-gray-900" />`;
        
        // Teks Total di tengah
        svg += `
            <text x="${cx}" y="${cy - 3}" text-anchor="middle" font-weight="bold" font-size="14" fill="#1e293b" class="dark:fill-gray-100">${total}</text>
            <text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="9" fill="#94a3b8">Total</text>
        `;

        // Gambar legenda di kanan
        const legendX = cx + radius + 25;
        const legendYStart = cy - (data.length * 16) / 2 + 6;
        data.forEach((val, i) => {
            const y = legendYStart + i * 18;
            svg += `
                <rect x="${legendX}" y="${y - 8}" width="10" height="10" rx="2" fill="${colors[i % colors.length]}" />
                <text x="${legendX + 16}" y="${y}" font-size="10" fill="#475569" class="dark:fill-gray-400" text-anchor="start">
                    ${labels[i].slice(0, 10)}${labels[i].length > 10 ? ".." : ""}: ${val} (${((val/total)*100).toFixed(0)}%)
                </text>
            `;
        });

        svg += `</svg>`;
        container.innerHTML = svg;
    }
};
