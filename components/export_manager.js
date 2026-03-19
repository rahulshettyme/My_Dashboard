/**
 * Export Manager Component
 * Handles CSV/Excel and PDF exports for the dashboard.
 */

async function exportToExcel(globalData, MASS_CONVERSIONS, AREA_CONVERSIONS, showPredictionAvailable) {
    const yieldLabel = 'Tonne/Ha';
    const harvestLabel = 'Tonne';

    const exportData = [];
    exportData.push([
        'Plot Name',
        'Audited Area (Ha)',
        `Expected Harvest (${harvestLabel})`,
        `Re-estimated Harvest (${harvestLabel})`,
        `Predicted Harvest Min (${harvestLabel})`,
        `Predicted Harvest Avg (${harvestLabel})`,
        `Predicted Harvest Max (${harvestLabel})`,
        `Expected Yield (${yieldLabel})`,
        `Re-estimated Yield (${yieldLabel})`,
        `Predicted Yield Min (${yieldLabel})`,
        `Predicted Yield Avg (${yieldLabel})`,
        `Predicted Yield Max (${yieldLabel})`
    ]);

    globalData.forEach(row => {
        if (!row._processed) return;
        const d = row._processed;

        const isAvailable = !d.noPrediction;
        if (showPredictionAvailable && !isAvailable) return;
        if (!showPredictionAvailable && isAvailable) return;

        const qUnit = (d.harvestUnit || 'kgs').toLowerCase();
        const aUnit = (d.areaUnit || 'ha').toLowerCase();
        const massFactor = MASS_CONVERSIONS[qUnit] || MASS_CONVERSIONS.kgs;
        const areaFactor = AREA_CONVERSIONS[aUnit] || AREA_CONVERSIONS.ha;

        const h1Ton = d.h1 / massFactor;
        const h2Ton = d.h2 / massFactor;
        const areaHa = d.auditedArea / areaFactor;

        let predHarvestMin = d.h3_min;
        let predHarvestMax = d.h3_max;
        let predHarvestAvg = (predHarvestMin + predHarvestMax) / 2;

        let predYieldMin = d.y3_min;
        let predYieldMax = d.y3_max;
        let predYieldAvg = (predYieldMin + predYieldMax) / 2;

        if (d.noPrediction || d.notEnabled) {
            predHarvestMin = predHarvestMax = predHarvestAvg = 'NA';
            predYieldMin = predYieldMax = predYieldAvg = 'NA';
        } else {
            predHarvestMin = parseFloat(predHarvestMin.toFixed(2));
            predHarvestMax = parseFloat(predHarvestMax.toFixed(2));
            predHarvestAvg = parseFloat(predHarvestAvg.toFixed(2));
            predYieldMin = parseFloat(predYieldMin.toFixed(2));
            predYieldMax = parseFloat(predYieldMax.toFixed(2));
            predYieldAvg = parseFloat(predYieldAvg.toFixed(2));
        }

        exportData.push([
            d.name || d.plotName,
            parseFloat(areaHa.toFixed(2)),
            parseFloat(h1Ton.toFixed(2)),
            parseFloat(h2Ton.toFixed(2)),
            predHarvestMin,
            predHarvestAvg,
            predHarvestMax,
            areaHa > 0 ? parseFloat((h1Ton / areaHa).toFixed(2)) : 0,
            areaHa > 0 ? parseFloat((h2Ton / areaHa).toFixed(2)) : 0,
            predYieldMin,
            predYieldAvg,
            predYieldMax
        ]);
    });

    // Use SheetJS (XLSX) if available
    if (window.XLSX) {
        const ws = window.XLSX.utils.aoa_to_sheet(exportData);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'All Plots Data');
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `Aggregate_Report_${showPredictionAvailable ? 'Available' : 'Pending'}_${timestamp}.xlsx`;
        window.XLSX.writeFile(wb, filename);
    } else {
        // Fallback to CSV
        const csvContent = "data:text/csv;charset=utf-8," + exportData.map(e => e.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Growth_Export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

async function exportDashboardToPDF() {
    const { jsPDF } = window.jspdf;
    const btn = document.getElementById('export-pdf-btn');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

    try {
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;

        const addPageHeader = (title) => {
            doc.setFontSize(18);
            doc.setTextColor(30, 41, 59);
            doc.text(title, pageWidth / 2, 20, { align: 'center' });
            doc.setDrawColor(226, 232, 240);
            doc.line(margin, 25, pageWidth - margin, 25);
        };

        // --- PAGE 1: OVERVIEW ---
        doc.setFontSize(24);
        doc.setTextColor(16, 185, 129); // Emerald-500
        doc.text("Growth Project Analysis", pageWidth / 2, 60, { align: 'center' });
        
        doc.setFontSize(12);
        doc.setTextColor(71, 85, 105);
        doc.text(`Report Date: ${new Date().toLocaleString()}`, margin, 80);
        
        let py = 100;
        doc.setFont(undefined, 'bold');
        doc.text("Selected Projects:", margin, py);
        doc.setFont(undefined, 'normal');
        
        const projectNames = Array.from(document.querySelectorAll('#project-select option:checked')).map(el => el.text).join(', ');
        const splitProjects = doc.splitTextToSize(projectNames || "None", pageWidth - 2 * margin);
        doc.text(splitProjects, margin, py + 7);
        py += 10 + (splitProjects.length * 7);

        doc.setFont(undefined, 'bold');
        doc.text(`Total Plots Evaluated: ${window.currentGrowthResults ? window.currentGrowthResults.length : 0}`, margin, py);

        // --- PAGE 2: AGGREGATED TABLES ---
        doc.addPage();
        addPageHeader("Aggregated Yield & Harvest Summary");
        
        const tempDiv = document.createElement('div');
        tempDiv.style.width = '800px';
        tempDiv.style.padding = '20px';
        tempDiv.style.background = '#0f172a';
        tempDiv.style.color = '#f8fafc';
        tempDiv.style.fontFamily = 'sans-serif';
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';

        const yieldData = {
            expected: document.getElementById('agg-exp-yield')?.textContent || '-',
            field: document.getElementById('agg-re-yield')?.textContent || '-',
            fieldDiff: document.getElementById('agg-re-diff')?.textContent || '',
            predicted: `${document.getElementById('agg-app-yield-min')?.textContent || '-'} - ${document.getElementById('agg-app-yield-max')?.textContent || '-'}`,
            pDiffExp: document.getElementById('agg-app-diff-exp')?.textContent || '',
            pDiffField: document.getElementById('agg-app-diff-re')?.textContent || '',
            cardLevel: document.getElementById('agg-card-level')?.textContent || '-'
        };

        const harvestData = {
            expected: document.getElementById('agg-exp-harvest')?.textContent || '-',
            field: document.getElementById('agg-re-harvest')?.textContent || '-',
            fieldDiff: document.getElementById('agg-re-harvest-diff')?.textContent || '',
            predicted: `${document.getElementById('agg-app-harvest-min')?.textContent || '-'} - ${document.getElementById('agg-app-harvest-max')?.textContent || '-'}`,
            pDiffExp: document.getElementById('agg-app-harvest-diff-exp')?.textContent || '',
            pDiffField: document.getElementById('agg-app-harvest-diff-re')?.textContent || '',
            collected: document.getElementById('agg-collected-harvest')?.textContent || '-'
        };

        const createTableHTML = (title, data, isYield) => `
            <div style="margin-bottom: 30px; border: 1px solid #334155; border-radius: 8px; overflow: hidden;">
                <div style="background: #1e293b; padding: 12px 15px; font-weight: bold; border-bottom: 1px solid #334155;">${title}</div>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr style="border-bottom: 1px solid #334155;">
                        <td style="padding: 10px; color: #94a3b8;">Expected ${isYield ? 'Yield' : 'Harvest'}</td>
                        <td style="padding: 10px; text-align: right; font-weight: bold;">${data.expected}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                        <td style="padding: 10px; color: #94a3b8;">Re-estimated (Field)</td>
                        <td style="padding: 10px; text-align: right; font-weight: bold;">${data.field} <span style="font-size: 12px; color: #ef4444;">${data.fieldDiff}</span></td>
                    </tr>
                    <tr style="border-bottom: 1px solid #334155;">
                        <td style="padding: 10px; color: #94a3b8;">Predicted Range</td>
                        <td style="padding: 10px; text-align: right; font-weight: bold; color: #818cf8;">${data.predicted}</td>
                    </tr>
                    <tr style="border-bottom: 10px solid #334155;">
                        <td style="padding: 10px; color: #94a3b8;">Predicted vs Expected</td>
                        <td style="padding: 10px; text-align: right; color: #10b981;">${data.pDiffExp}</td>
                    </tr>
                    ${isYield ? `
                        <tr>
                            <td style="padding: 10px; color: #94a3b8;">Card Level</td>
                            <td style="padding: 10px; text-align: right;">${data.cardLevel}</td>
                        </tr>
                    ` : `
                        <tr>
                            <td style="padding: 10px; color: #94a3b8;">Collected Harvest</td>
                            <td style="padding: 10px; text-align: right; color: #a78bfa; font-weight: bold;">${data.collected}</td>
                        </tr>
                    `}
                </table>
            </div>
        `;

        tempDiv.innerHTML = `
            <h2 style="color: #10b981; margin-bottom: 20px;">Aggregated Analytics</h2>
            ${createTableHTML("Project Yield Analysis", yieldData, true)}
            ${createTableHTML("Project Harvest Analysis", harvestData, false)}
        `;
        document.body.appendChild(tempDiv);

        const tableCanvas = await html2canvas(tempDiv, { backgroundColor: '#0f172a', scale: 2 });
        const tableImgData = tableCanvas.toDataURL('image/png');
        const imgProps = doc.getImageProperties(tableImgData);
        const pdfWidth = pageWidth - 2 * margin;
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        doc.addImage(tableImgData, 'PNG', margin, 35, pdfWidth, pdfHeight);
        document.body.removeChild(tempDiv);

        // --- CHART PAGES ---
        const charts = [
            { id: 'growthProgressionChart', title: 'Growth Progression Distribution' },
            { id: 'harvestWindowChart', title: 'Weekly Harvest Window' },
            { id: 'harvestDailyChart', title: 'Daily Harvest Window' },
            { id: 'harvest-window-pie-chart', title: 'Harvest Status Alignment' }
        ];

        for (const chartInfo of charts) {
            const chartCanvas = document.getElementById(chartInfo.id);
            if (!chartCanvas) continue;
            
            doc.addPage();
            addPageHeader(chartInfo.title);
            
            const chartImgData = chartCanvas.toDataURL('image/png');
            doc.addImage(chartImgData, 'PNG', margin, 40, pageWidth - 2 * margin, 100);
            
            // Add legend/details if relevant
            if (chartInfo.id === 'harvestWindowChart') {
                doc.setFontSize(10);
                doc.setTextColor(148, 163, 184);
                doc.text("Aggregation: Monday to Sunday | Range: Next 8 Available Weeks", pageWidth / 2, 150, { align: 'center' });
            }
        }

        // --- FINAL PAGE: BASE TABLE DATA ---
        if (window.currentGrowthResults && window.currentGrowthResults.length > 0) {
            doc.addPage();
            addPageHeader("Base Plot Data Table");
            
            const tableHeaders = ["Plot Name", "Area", "Exp Harvest", "Stage", "Prog %", "H-Start", "H-End"];
            const tableRows = window.currentGrowthResults.map(p => [
                p.plotName,
                (p.auditedArea || 0).toFixed(2),
                (p.expectedHarvestTon || 0).toFixed(2),
                p.currentStage || "-",
                p.progression + "%",
                p.hStart || "-",
                p.hEnd || "-"
            ]);

            doc.setFontSize(9);
            let tx = margin;
            let ty = 40;
            const colWidths = [45, 20, 25, 30, 20, 25, 25];

            // Draw Headers
            doc.setFont(undefined, 'bold');
            tableHeaders.forEach((h, i) => {
                doc.text(h, tx, ty);
                tx += colWidths[i];
            });
            doc.line(margin, ty + 2, pageWidth - margin, ty + 2);
            ty += 8;

            // Draw Rows
            doc.setFont(undefined, 'normal');
            tableRows.forEach((row, rowIndex) => {
                if (ty > pageHeight - 20) {
                    doc.addPage();
                    addPageHeader("Base Plot Data Table (Cont.)");
                    ty = 40;
                    doc.setFont(undefined, 'bold');
                    let ctx = margin;
                    tableHeaders.forEach((h, i) => { doc.text(h, ctx, ty); ctx += colWidths[i]; });
                    doc.line(margin, ty + 2, pageWidth - margin, ty + 2);
                    ty += 8;
                    doc.setFont(undefined, 'normal');
                }
                
                let rtx = margin;
                row.forEach((cell, i) => {
                    const cellStr = String(cell);
                    const truncated = doc.truncateText(cellStr, colWidths[i] - 2);
                    doc.text(truncated, rtx, ty);
                    rtx += colWidths[i];
                });
                ty += 6;
            });
        }

        doc.save(`Growth_Analysis_Report_${new Date().toISOString().split('T')[0]}.pdf`);

    } catch (err) {
        console.error("PDF Export Error:", err);
        alert("An error occurred while generating the PDF. Please try again.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}
