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
        'Is Harvested',
        'Harvested Date',
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
            d.isHarvested || d.harvestStatus || (d.harvested ? 'Yes' : 'No') || '-',
            d.harvestedDate || d.actualHarvestDate || '-',
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
        const doc = new jspdf.jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            compress: true
        });
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
        doc.text("Aggregate Data Testing", pageWidth / 2, 60, { align: 'center' });
        
        doc.setFontSize(12);
        doc.setTextColor(71, 85, 105);
        doc.text(`Report Date: ${new Date().toLocaleString()}`, margin, 80);
        
        let py = 100;
        doc.setFont(undefined, 'bold');
        doc.text("Selected Projects:", margin, py);
        doc.setFont(undefined, 'normal');
        
        // Fix: Properly scrape project names from the custom multi-select checkboxes
        const projectNames = Array.from(document.querySelectorAll('#projects-dropdown-list input:checked'))
            .map(cb => cb.nextElementSibling.textContent).join(', ') || 'None';
            
        const splitProjects = doc.splitTextToSize(projectNames, pageWidth - 2 * margin);
        doc.text(splitProjects, margin, py + 7);
        py += 10 + (splitProjects.length * 7);

        doc.setFont(undefined, 'bold');
        doc.text(`Total Plots Selected: ${document.getElementById('plot-count')?.textContent || '0'}`, margin, py);

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
            // Fix: Use correct 'ai' IDs
            predicted: `${document.getElementById('agg-ai-yield-min')?.textContent || '-'} - ${document.getElementById('agg-ai-yield-max')?.textContent || '-'}`,
            pDiffExp: document.getElementById('agg-ai-diff-exp')?.textContent || '',
            pDiffRe: document.getElementById('agg-ai-diff-re')?.textContent || '',
            cardLevel: document.getElementById('agg-card-level')?.textContent || '-'
        };

        const harvestData = {
            expected: document.getElementById('agg-exp-harvest')?.textContent || '-',
            field: document.getElementById('agg-re-harvest')?.textContent || '-',
            fieldDiff: document.getElementById('agg-re-harvest-diff')?.textContent || '',
            // Fix: Use correct 'ai' IDs
            predicted: `${document.getElementById('agg-ai-harvest-min')?.textContent || '-'} - ${document.getElementById('agg-ai-harvest-max')?.textContent || '-'}`,
            pDiffExp: document.getElementById('agg-ai-harvest-diff-exp')?.textContent || '',
            pDiffRe: document.getElementById('agg-ai-harvest-diff-re')?.textContent || '',
            collected: document.getElementById('stat-harvest-collected')?.textContent || '-'
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
                    <tr style="border-bottom: 1px solid #334155;">
                        <td style="padding: 10px; color: #94a3b8;">Predicted vs Expected</td>
                        <td style="padding: 10px; text-align: right; color: #10b981;">${data.pDiffExp}</td>
                    </tr>
                    <tr style="border-bottom: 10px solid #334155;">
                        <td style="padding: 10px; color: #94a3b8;">Predicted vs Re-estimated</td>
                        <td style="padding: 10px; text-align: right; color: #10b981;">${data.pDiffRe}</td>
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

        const tableCanvas = await html2canvas(tempDiv, { backgroundColor: '#0f172a', scale: 1.2 });
        const tableImgData = tableCanvas.toDataURL('image/jpeg', 0.8);
        const imgProps = doc.getImageProperties(tableImgData);
        const pdfWidth = pageWidth - 2 * margin;
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        doc.addImage(tableImgData, 'JPEG', margin, 35, pdfWidth, pdfHeight);
        document.body.removeChild(tempDiv);

        // --- CHART PAGES (Consolidated) ---
        const groups = [
            {
                title: "Growth Progression & Harvest Status",
                charts: [
                    { id: 'growthProgressionChart', label: '1. Growth Progression Distribution' },
                    { id: 'harvest-status-results', label: '2. Harvest Status' }
                ]
            },
            {
                title: "Harvest Windows (Weekly & Daily)",
                charts: [
                    { id: 'harvestWindowChart', label: '1. Weekly Harvest Window' },
                    { id: 'harvestDailyChart', label: '2. Daily Harvest Window' }
                ]
            }
        ];

        for (const group of groups) {
            doc.addPage();
            addPageHeader(group.title);
            let currentY = 40;

            for (const chartSec of group.charts) {
                const el = document.getElementById(chartSec.id);
                if (!el) continue;

                const container = (chartSec.id === 'harvest-status-results') ? el : (el.closest('.analysis-card') || el.closest('.metric-card') || el.parentElement);
                if (!container) continue;

                // Capture the container
                const canvas = await html2canvas(container, { 
                    backgroundColor: '#1e1e2e', 
                    scale: 1.2,
                    onclone: (clonedDoc) => {
                        if (chartSec.id === 'harvest-status-results') {
                            const cards = clonedDoc.querySelectorAll('.analysis-card');
                            cards.forEach(card => {
                                if (card.textContent.includes('Plot Harvest Status')) {
                                    card.style.display = 'none';
                                }
                            });
                        }
                    }
                });

                const imgData = canvas.toDataURL('image/jpeg', 0.8);
                const cProps = doc.getImageProperties(imgData);
                const cWidth = pageWidth - 2 * margin;
                const cHeight = (cProps.height * cWidth) / cProps.width;
                
                // Scale down slightly to fit two charts comfortably
                const drawHeight = Math.min(cHeight, 105); 
                
                doc.setFontSize(10);
                doc.setTextColor(100, 116, 139);
                doc.text(chartSec.label, margin, currentY - 2);

                doc.addImage(imgData, 'JPEG', margin, currentY, cWidth, drawHeight);
                currentY += drawHeight + 15; // Gap between charts

                if (chartSec.id === 'harvestWindowChart') {
                    doc.setFontSize(8.5);
                    doc.setTextColor(148, 163, 184);
                    if (currentY < pageHeight - 5) {
                       doc.text("Aggregation: Monday to Sunday | Range: Next 8 Available Weeks", pageWidth / 2, currentY - 8, { align: 'center' });
                    }
                }
            }
        }

        // --- FINAL PAGE: BASE TABLE DATA ---
        if (window.currentGrowthResults && window.currentGrowthResults.length > 0) {
            doc.addPage();
            addPageHeader("Base Plot Data Table");
            
            const tableHeaders = ["Plot Name", "Audited Area", "Expected Harvest", "Is Harvested", "Harvested Date", "Current Stage", "Progression", "Start Date", "End Date"];
            const tableRows = window.currentGrowthResults.map(p => [
                p.plotName,
                (p.auditedArea || 0).toFixed(2),
                (p.expectedHarvestTon || 0).toFixed(2),
                p.isHarvested || "-",
                p.harvestedDate || "-",
                p.currentStage || "-",
                (p.progression || 0) + "%",
                p.hStart || "-",
                p.hEnd || "-"
            ]);

            doc.setFontSize(7);
            const colWidths = [35, 12, 25, 12, 18, 28, 15, 18, 18]; // Total 181
            let ty = 40;

            const drawHeaders = (y) => {
                doc.setFont(undefined, 'bold');
                doc.setFontSize(7);
                doc.setTextColor(30, 41, 59);
                let tx = margin;
                let maxHeight = 0;
                
                // First pass: find max header height
                const linesPerHeader = tableHeaders.map((h, i) => {
                    const lines = doc.splitTextToSize(h, colWidths[i] - 1);
                    maxHeight = Math.max(maxHeight, lines.length * 4);
                    return lines;
                });

                // Second pass: draw
                tableHeaders.forEach((h, i) => {
                    doc.text(linesPerHeader[i], tx, y);
                    tx += colWidths[i];
                });
                
                doc.line(margin, y + maxHeight - 2, pageWidth - margin, y + maxHeight - 2);
                return maxHeight;
            };

            // Initial headers
            const headerHeight = drawHeaders(ty);
            ty += headerHeight + 2;

            // Draw Rows
            doc.setFont(undefined, 'normal');
            doc.setTextColor(30, 41, 59);
            tableRows.forEach((row, rowIndex) => {
                if (ty > pageHeight - 20) {
                    doc.addPage();
                    addPageHeader("Base Plot Data Table (Cont.)");
                    const hOffset = drawHeaders(45);
                    ty = 45 + hOffset + 2;
                    doc.setFont(undefined, 'normal');
                    doc.setTextColor(30, 41, 59);
                }
                
                let rtx = margin;
                row.forEach((cell, i) => {
                    const cellStr = String(cell);
                    const maxWidth = colWidths[i] - 2;
                    let truncated = cellStr;
                    if (doc.getTextWidth(truncated) > maxWidth) {
                        while (doc.getTextWidth(truncated + "...") > maxWidth && truncated.length > 0) {
                            truncated = truncated.slice(0, -1);
                        }
                        truncated += "...";
                    }
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
