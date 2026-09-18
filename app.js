/**
 * Master Application State & Workflow Controller (Version 2.0)
 * Manages DICOM series loading, independent TTF/NPS slice ranges, independent TTF/NPS ROI configurations,
 * TTF Circular Rod analysis, Task-based Detectability (d'), unified Bootstrap resampling, *.ctqa project save/load, and 7-file CSV exports.
 */
class AppController {
  constructor() {
    this.dicomSeries = [];        // Sorted array of DICOM slice objects
    this.currentData = null;      // Currently active preview slice object
    this.dicomFolderPath = "";    // Folder path / label

    // Extracted ROI pixel data arrays
    this.extractedNpsRois = [];   // Array of Float32Array NPS noise ROIs
    this.extractedTtfRois = [];   // Array of Float32Array TTF rod ROIs
    
    // NPS ROI Settings
    this.npsRoiSizeMode = "mm";      // "mm" | "pixel"
    this.npsRoiSizeMm = 80.0;
    this.npsRoiSizePx = 128;
    this.npsRoiPlacement = "center"; // "center" | "manual" | "multi"
    this.npsMultiRoiCount = 16;
    this.npsRoiPositions = [];       // Array of { x, y }

    // TTF ROI Settings
    this.ttfRoiSizeMode = "mm";      // "mm" | "pixel"
    this.ttfRoiSizeMm = 40.0;
    this.ttfRoiSizePx = 64;
    this.ttfRoiPlacement = "center"; // "center" | "manual"
    this.ttfRoiPositions = [];       // Array of { x, y }

    // Results Store
    this.npsResult = null;        // NPS analysis result object
    this.ttfResult = null;        // TTF analysis result object
    this.detectabilityResult = null; // Detectability d' result object
    this.bootstrapResult = null;  // Unified Bootstrap 95% CIs result

    // Chart Manager
    this.chartManager = null;

    // Slice Range Parameters (Independent for TTF & NPS)
    this.currentViewIndex = 0;    // 0-indexed slice viewed in Panel 1
    this.npsStartSliceIndex = 0;  // 0-indexed start slice for NPS
    this.npsEndSliceIndex = 0;    // 0-indexed end slice for NPS
    this.ttfStartSliceIndex = 0;  // 0-indexed start slice for TTF
    this.ttfEndSliceIndex = 0;    // 0-indexed end slice for TTF

    // Configuration Parameters (AAPM TG233 Mode Default)
    this.mode = "tg233";          // "tg233" | "research"
    this.trendMethod = "mean";   // "mean" | "plane" | "poly"
    this.windowType = "none";    // "none" | "hann" | "hamming" | "welch" | "bartlett"
    this.binWidth = 0.01;        // 0.005, 0.01, 0.02, 0.05
    this.excludeDC = true;

    // Task & Detectability Parameters
    this.taskDiameter = 10.0;    // mm
    this.taskContrast = 120.0;   // HU
    this.task2Enabled = true;    // Dual Task Mode
    this.task2Diameter = 5.0;    // Task 2 mm
    this.task2Contrast = 100.0;  // Task 2 HU
    this.observer = "NPW";       // "NPW" | "NPWE"
    this.commonNyquist = false;
    this.specFMin = 0.010;       // Specified Range f_min (cycles/mm)
    this.specFMax = 0.500;       // Specified Range f_max (cycles/mm)
    this.bootstrapIterations = 1000;

    // Display Windowing (HU)
    this.windowCenter = 40.0;
    this.windowWidth = 400.0;

    this.initUI();
  }

  // Legacy getters/setters mapping startSliceIndex to npsStartSliceIndex
  get startSliceIndex() { return this.npsStartSliceIndex; }
  set startSliceIndex(v) { this.npsStartSliceIndex = v; }
  get endSliceIndex() { return this.npsEndSliceIndex; }
  set endSliceIndex(v) { this.npsEndSliceIndex = v; }

  get roiSizeMode() { return this.npsRoiSizeMode; }
  set roiSizeMode(v) { this.npsRoiSizeMode = v; }
  get roiSizeMm() { return this.npsRoiSizeMm; }
  set roiSizeMm(v) { this.npsRoiSizeMm = v; }
  get roiSizePx() { return this.npsRoiSizePx; }
  set roiSizePx(v) { this.npsRoiSizePx = v; }
  get roiPlacement() { return this.npsRoiPlacement; }
  set roiPlacement(v) { this.npsRoiPlacement = v; }
  get roiPositions() { return this.npsRoiPositions; }
  set roiPositions(v) { this.npsRoiPositions = v; }
  get multiRoiCount() { return this.npsMultiRoiCount; }
  set multiRoiCount(v) { this.npsMultiRoiCount = v; }

  initUI() {
    this.chartManager = new NpsChartManager("chart1DNps");

    // Workspace Navigation Tabs
    this.initTabNavigation();

    // Folder & File Loading Listeners
    document.getElementById("folderInput")?.addEventListener("change", (e) => this.handleMultiFileSelect(e.target.files));
    document.getElementById("fileInput")?.addEventListener("change", (e) => this.handleMultiFileSelect(e.target.files));
    document.getElementById("btnGenPhantom")?.addEventListener("click", () => this.generatePhantom());

    // Mode Presets
    document.getElementById("btnPresetTG233")?.addEventListener("click", () => this.setPresetMode("tg233"));
    document.getElementById("btnPresetResearch")?.addEventListener("click", () => this.setPresetMode("research"));

    // Project & CSV Export Buttons
    document.getElementById("btnSaveProject")?.addEventListener("click", () => ProjectManager.saveProject(this));
    document.getElementById("btnTabSaveProj")?.addEventListener("click", () => ProjectManager.saveProject(this));

    document.getElementById("btnLoadProject")?.addEventListener("click", () => document.getElementById("fileProjectLoad")?.click());
    document.getElementById("btnTabLoadProj")?.addEventListener("click", () => document.getElementById("fileProjectLoad")?.click());
    document.getElementById("fileProjectLoad")?.addEventListener("change", (e) => this.handleProjectLoad(e.target.files[0]));

    document.getElementById("btnExportAllCsv")?.addEventListener("click", () => CSVExporter.exportAll(this));
    document.getElementById("btnExportCsv")?.addEventListener("click", () => CSVExporter.exportAll(this));
    document.getElementById("btnTabExportCsv")?.addEventListener("click", () => CSVExporter.exportAll(this));

    // Slice Range Listeners (NPS)
    document.getElementById("startSliceInput")?.addEventListener("input", (e) => {
      let val = parseInt(e.target.value, 10) || 1;
      val = Math.max(1, Math.min(this.dicomSeries.length, val));
      this.npsStartSliceIndex = val - 1;
      if (this.npsStartSliceIndex > this.npsEndSliceIndex) {
        this.npsEndSliceIndex = this.npsStartSliceIndex;
        document.getElementById("endSliceInput").value = this.npsEndSliceIndex + 1;
      }
      this.updateSliceRangeUI();
      this.extractRois();
      this.runAnalysis();
    });

    document.getElementById("endSliceInput")?.addEventListener("input", (e) => {
      let val = parseInt(e.target.value, 10) || 1;
      val = Math.max(1, Math.min(this.dicomSeries.length, val));
      this.npsEndSliceIndex = val - 1;
      if (this.npsEndSliceIndex < this.npsStartSliceIndex) {
        this.npsStartSliceIndex = this.npsEndSliceIndex;
        document.getElementById("startSliceInput").value = this.npsStartSliceIndex + 1;
      }
      this.updateSliceRangeUI();
      this.extractRois();
      this.runAnalysis();
    });

    document.getElementById("btnSetStartCurrent")?.addEventListener("click", () => {
      if (this.dicomSeries.length === 0) return;
      const currentNum = this.currentViewIndex + 1;
      this.npsStartSliceIndex = this.currentViewIndex;
      document.getElementById("startSliceInput").value = currentNum;
      if (this.npsStartSliceIndex > this.npsEndSliceIndex) {
        this.npsEndSliceIndex = this.npsStartSliceIndex;
        document.getElementById("endSliceInput").value = currentNum;
      }
      this.updateSliceRangeUI();
      this.extractRois();
      this.runAnalysis();
    });

    document.getElementById("btnSetEndCurrent")?.addEventListener("click", () => {
      if (this.dicomSeries.length === 0) return;
      const currentNum = this.currentViewIndex + 1;
      this.npsEndSliceIndex = this.currentViewIndex;
      document.getElementById("endSliceInput").value = currentNum;
      if (this.npsEndSliceIndex < this.npsStartSliceIndex) {
        this.npsStartSliceIndex = this.npsEndSliceIndex;
        document.getElementById("startSliceInput").value = currentNum;
      }
      this.updateSliceRangeUI();
      this.extractRois();
      this.runAnalysis();
    });

    // Slice Range Listeners (TTF)
    document.getElementById("startSliceTTF")?.addEventListener("input", (e) => {
      let val = parseInt(e.target.value, 10) || 1;
      val = Math.max(1, Math.min(this.dicomSeries.length, val));
      this.ttfStartSliceIndex = val - 1;
      if (this.ttfStartSliceIndex > this.ttfEndSliceIndex) {
        this.ttfEndSliceIndex = this.ttfStartSliceIndex;
        document.getElementById("endSliceTTF").value = this.ttfEndSliceIndex + 1;
      }
      this.updateSliceRangeUI();
      this.extractRois();
      this.runAnalysis();
    });

    document.getElementById("endSliceTTF")?.addEventListener("input", (e) => {
      let val = parseInt(e.target.value, 10) || 1;
      val = Math.max(1, Math.min(this.dicomSeries.length, val));
      this.ttfEndSliceIndex = val - 1;
      if (this.ttfEndSliceIndex < this.ttfStartSliceIndex) {
        this.ttfStartSliceIndex = this.ttfEndSliceIndex;
        document.getElementById("startSliceTTF").value = this.ttfStartSliceIndex + 1;
      }
      this.updateSliceRangeUI();
      this.extractRois();
      this.runAnalysis();
    });

    document.getElementById("btnSetTTFStart")?.addEventListener("click", () => {
      if (this.dicomSeries.length === 0) return;
      const currentNum = this.currentViewIndex + 1;
      this.ttfStartSliceIndex = this.currentViewIndex;
      document.getElementById("startSliceTTF").value = currentNum;
      if (this.ttfStartSliceIndex > this.ttfEndSliceIndex) {
        this.ttfEndSliceIndex = this.ttfStartSliceIndex;
        document.getElementById("endSliceTTF").value = currentNum;
      }
      this.updateSliceRangeUI();
      this.extractRois();
      this.runAnalysis();
    });

    document.getElementById("btnSetTTFEnd")?.addEventListener("click", () => {
      if (this.dicomSeries.length === 0) return;
      const currentNum = this.currentViewIndex + 1;
      this.ttfEndSliceIndex = this.currentViewIndex;
      document.getElementById("endSliceTTF").value = currentNum;
      if (this.ttfEndSliceIndex < this.ttfStartSliceIndex) {
        this.ttfStartSliceIndex = this.ttfEndSliceIndex;
        document.getElementById("startSliceTTF").value = currentNum;
      }
      this.updateSliceRangeUI();
      this.extractRois();
      this.runAnalysis();
    });

    // Preview Slice View Slider
    document.getElementById("sliderViewSlice")?.addEventListener("input", (e) => {
      const idx = parseInt(e.target.value, 10) - 1;
      if (idx >= 0 && idx < this.dicomSeries.length) {
        this.currentViewIndex = idx;
        this.currentData = this.dicomSeries[idx];
        document.getElementById("valViewSlice").textContent = `${idx + 1} / ${this.dicomSeries.length}`;
        this.renderAllCanvases();
      }
    });

    // ROI Sub-Tab Buttons (NPS vs TTF)
    document.getElementById("btnSubTabNpsRoi")?.addEventListener("click", () => {
      document.getElementById("btnSubTabNpsRoi")?.classList.add("active-preset");
      document.getElementById("btnSubTabTtfRoi")?.classList.remove("active-preset");
      document.getElementById("panelNpsRoiConfig").style.display = "block";
      document.getElementById("panelTtfRoiConfig").style.display = "none";
    });

    document.getElementById("btnSubTabTtfRoi")?.addEventListener("click", () => {
      document.getElementById("btnSubTabTtfRoi")?.classList.add("active-preset");
      document.getElementById("btnSubTabNpsRoi")?.classList.remove("active-preset");
      document.getElementById("panelTtfRoiConfig").style.display = "block";
      document.getElementById("panelNpsRoiConfig").style.display = "none";
    });

    // NPS ROI Parameter Listeners
    document.getElementById("roiSizeModeSelect")?.addEventListener("change", (e) => {
      this.npsRoiSizeMode = e.target.value;
      this.updateRoiSizeControls();
      this.syncRoiSizePx();
      this.updateRoiLayout();
    });

    document.getElementById("roiSizeInput")?.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 10;
      if (this.npsRoiSizeMode === "mm") {
        this.npsRoiSizeMm = val;
        this.syncRoiSizePx();
      } else {
        this.npsRoiSizePx = Math.round(val);
      }
      this.updateRoiLayout();
    });

    document.getElementById("roiPlacementSelect")?.addEventListener("change", (e) => {
      this.npsRoiPlacement = e.target.value;
      this.updateRoiLayout();
    });

    document.getElementById("multiRoiCountSelect")?.addEventListener("change", (e) => {
      this.npsMultiRoiCount = parseInt(e.target.value, 10);
      this.updateRoiLayout();
    });

    // TTF ROI Parameter Listeners
    document.getElementById("ttfRoiSizeModeSelect")?.addEventListener("change", (e) => {
      this.ttfRoiSizeMode = e.target.value;
      this.updateTtfRoiSizeControls();
      this.syncTtfRoiSizePx();
      this.updateRoiLayout();
    });

    document.getElementById("ttfRoiSizeInput")?.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 5;
      if (this.ttfRoiSizeMode === "mm") {
        this.ttfRoiSizeMm = val;
        this.syncTtfRoiSizePx();
      } else {
        this.ttfRoiSizePx = Math.round(val);
      }
      this.updateRoiLayout();
    });

    document.getElementById("ttfRoiPlacementSelect")?.addEventListener("change", (e) => {
      this.ttfRoiPlacement = e.target.value;
      this.updateRoiLayout();
    });

    // Task & Observer Listeners
    document.getElementById("taskDiameterInput")?.addEventListener("input", (e) => {
      this.taskDiameter = parseFloat(e.target.value) || 10.0;
      this.runAnalysis();
    });

    document.getElementById("taskContrastInput")?.addEventListener("input", (e) => {
      this.taskContrast = parseFloat(e.target.value) || 120.0;
      this.runAnalysis();
    });

    document.getElementById("task2EnableToggle")?.addEventListener("change", (e) => {
      this.task2Enabled = e.target.checked;
      const p = document.getElementById("panelTask2Inputs");
      if (p) p.style.opacity = this.task2Enabled ? "1" : "0.4";
      const card2 = document.getElementById("cardTask2Container");
      if (card2) card2.style.display = this.task2Enabled ? "block" : "none";
      this.runAnalysis();
    });

    document.getElementById("task2DiameterInput")?.addEventListener("input", (e) => {
      this.task2Diameter = parseFloat(e.target.value) || 5.0;
      this.runAnalysis();
    });

    document.getElementById("task2ContrastInput")?.addEventListener("input", (e) => {
      this.task2Contrast = parseFloat(e.target.value) || 100.0;
      this.runAnalysis();
    });

    document.getElementById("observerSelect")?.addEventListener("change", (e) => {
      this.observer = e.target.value;
      this.runAnalysis();
    });

    document.getElementById("specFMinInput")?.addEventListener("input", (e) => {
      this.specFMin = parseFloat(e.target.value) || 0.010;
      this.runAnalysis();
    });

    document.getElementById("specFMaxInput")?.addEventListener("input", (e) => {
      this.specFMax = parseFloat(e.target.value) || 0.500;
      this.runAnalysis();
    });

    document.getElementById("commonNyquistToggle")?.addEventListener("change", (e) => {
      this.commonNyquist = e.target.checked;
      this.runAnalysis();
    });

    // Bootstrap Action Button
    document.getElementById("bootstrapSelect")?.addEventListener("change", (e) => {
      this.bootstrapIterations = parseInt(e.target.value, 10);
    });

    document.getElementById("btnRunBootstrap")?.addEventListener("click", () => this.runBootstrap());

    // Window / Level Sliders
    document.getElementById("sliderWW")?.addEventListener("input", (e) => {
      this.windowWidth = parseFloat(e.target.value);
      document.getElementById("valWW").textContent = Math.round(this.windowWidth);
      this.renderAllCanvases();
    });

    document.getElementById("sliderWC")?.addEventListener("input", (e) => {
      this.windowCenter = parseFloat(e.target.value);
      document.getElementById("valWC").textContent = Math.round(this.windowCenter);
      this.renderAllCanvases();
    });

    // Canvas Mouse Click Listener for Manual ROI Position (NPS vs TTF)
    document.getElementById("canvasOriginal")?.addEventListener("click", (e) => {
      if (!this.currentData) return;
      const rect = e.target.getBoundingClientRect();
      const scaleX = this.currentData.width / rect.width;
      const scaleY = this.currentData.height / rect.height;
      const clickX = Math.round((e.clientX - rect.left) * scaleX);
      const clickY = Math.round((e.clientY - rect.top) * scaleY);

      const isTtfTabActive = document.getElementById("btnSubTabTtfRoi")?.classList.contains("active-preset");

      if (isTtfTabActive || this.ttfRoiPlacement === "manual") {
        this.ttfRoiPositions = [{ x: clickX, y: clickY }];
        this.ttfRoiPlacement = "manual";
        const sel = document.getElementById("ttfRoiPlacementSelect");
        if (sel) sel.value = "manual";
      } else if (this.npsRoiPlacement === "manual") {
        this.npsRoiPositions = [{ x: clickX, y: clickY }];
      }

      this.extractRois();
      this.renderOriginalCanvas();
      this.renderTtfRoiCanvas();
      this.runAnalysis();
    });

    // Canvas Mouse Click Listener for TTF ROI Preview Canvas (canvasTtfRoi)
    document.getElementById("canvasTtfRoi")?.addEventListener("click", (e) => {
      if (!this.currentData) return;
      const rect = e.target.getBoundingClientRect();
      const scaleX = this.ttfRoiSizePx / rect.width;
      const scaleY = this.ttfRoiSizePx / rect.height;

      const clickXInRoi = (e.clientX - rect.left) * scaleX;
      const clickYInRoi = (e.clientY - rect.top) * scaleY;

      // Current ROI center in DICOM coordinates
      const currentPos = (this.ttfRoiPositions && this.ttfRoiPositions.length > 0)
        ? this.ttfRoiPositions[0]
        : { x: Math.floor(this.currentData.width / 2), y: Math.floor(this.currentData.height / 2) };

      const halfTtf = Math.floor(this.ttfRoiSizePx / 2);
      const roiStartX = currentPos.x - halfTtf;
      const roiStartY = currentPos.y - halfTtf;

      const newX = Math.round(roiStartX + clickXInRoi);
      const newY = Math.round(roiStartY + clickYInRoi);

      this.ttfRoiPositions = [{ x: newX, y: newY }];
      this.ttfRoiPlacement = "manual";
      const sel = document.getElementById("ttfRoiPlacementSelect");
      if (sel) sel.value = "manual";

      this.extractRois();
      this.renderOriginalCanvas();
      this.renderTtfRoiCanvas();
      this.runAnalysis();
    });
  }

  initTabNavigation() {
    const tabs = [
      { btn: "tabNavNPS", view: "viewNPS" },
      { btn: "tabNavTTF", view: "viewTTF" },
      { btn: "tabNavDetectability", view: "viewDetectability" },
      { btn: "tabNavProject", view: "viewProject" }
    ];

    tabs.forEach(t => {
      document.getElementById(t.btn)?.addEventListener("click", () => {
        tabs.forEach(x => {
          document.getElementById(x.btn)?.classList.remove("active");
          document.getElementById(x.view)?.classList.remove("active-view");
        });
        document.getElementById(t.btn)?.classList.add("active");
        document.getElementById(t.view)?.classList.add("active-view");

        // Re-render canvases and trigger layout resize when tab becomes active
        this.renderAllCanvases();
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 50);
      });
    });
  }

  setPresetMode(mode) {
    this.mode = mode;
    const btnTG = document.getElementById("btnPresetTG233");
    const btnRes = document.getElementById("btnPresetResearch");

    if (mode === "tg233") {
      btnTG?.classList.add("active-preset");
      btnRes?.classList.remove("active-preset");
      this.trendMethod = "mean";
      this.windowType = "none";
      this.binWidth = 0.01;
      this.excludeDC = true;
      this.observer = "NPW";
      this.commonNyquist = false;
    } else {
      btnRes?.classList.add("active-preset");
      btnTG?.classList.remove("active-preset");
    }

    this.extractRois();
    this.runAnalysis();
  }

  async handleMultiFileSelect(fileList) {
    if (!fileList || fileList.length === 0) return;
    this.dicomSeries = [];

    const files = Array.from(fileList);
    if (files.length > 0 && files[0].webkitRelativePath) {
      const parts = files[0].webkitRelativePath.split("/");
      if (parts.length > 1) this.dicomFolderPath = parts[0];
    }

    const badge = document.getElementById("lblTotalSlices");
    if (badge) badge.textContent = "⌛ DICOM 解析中...";

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buffer = await file.arrayBuffer();
        const dicom = DicomParser.parse(buffer);
        if (dicom && dicom.pixelArray) {
          this.dicomSeries.push(dicom);
        }
      } catch (e) {
        // Skip non-DICOM files
      }
      if (i % 20 === 0 || i === files.length - 1) {
        if (badge) badge.textContent = `⌛ 読込中 (${i + 1}/${files.length})...`;
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (this.dicomSeries.length === 0) {
      alert("選択されたフォルダ/ファイルから有効なDICOM画像を読み込めませんでした。");
      if (badge) badge.textContent = "0 スライス";
      return;
    }

    // Sort slice series naturally by Slice Location / Instance Number
    this.dicomSeries.sort((a, b) => (a.sliceLocation - b.sliceLocation) || (a.instanceNumber - b.instanceNumber));

    const numSlices = this.dicomSeries.length;

    // Preserve previous slice ranges if set and valid, otherwise default to full range
    if (this.npsStartSliceIndex !== undefined && this.npsStartSliceIndex < numSlices) {
      this.npsStartSliceIndex = Math.max(0, Math.min(numSlices - 1, this.npsStartSliceIndex));
    } else {
      this.npsStartSliceIndex = 0;
    }

    if (this.npsEndSliceIndex !== undefined && this.npsEndSliceIndex < numSlices) {
      this.npsEndSliceIndex = Math.max(this.npsStartSliceIndex, Math.min(numSlices - 1, this.npsEndSliceIndex));
    } else {
      this.npsEndSliceIndex = numSlices - 1;
    }

    if (this.ttfStartSliceIndex !== undefined && this.ttfStartSliceIndex < numSlices) {
      this.ttfStartSliceIndex = Math.max(0, Math.min(numSlices - 1, this.ttfStartSliceIndex));
    } else {
      this.ttfStartSliceIndex = 0;
    }

    if (this.ttfEndSliceIndex !== undefined && this.ttfEndSliceIndex < numSlices) {
      this.ttfEndSliceIndex = Math.max(this.ttfStartSliceIndex, Math.min(numSlices - 1, this.ttfEndSliceIndex));
    } else {
      this.ttfEndSliceIndex = numSlices - 1;
    }

    if (this.currentViewIndex !== undefined && this.currentViewIndex < numSlices) {
      this.currentViewIndex = Math.max(0, Math.min(numSlices - 1, this.currentViewIndex));
    } else {
      this.currentViewIndex = 0;
    }

    this.currentData = this.dicomSeries[this.currentViewIndex];
    this.windowCenter = this.currentData.windowCenter !== undefined ? this.currentData.windowCenter : 40.0;
    this.windowWidth = this.currentData.windowWidth !== undefined ? this.currentData.windowWidth : 400.0;

    document.getElementById("valWW").textContent = Math.round(this.windowWidth);
    document.getElementById("valWC").textContent = Math.round(this.windowCenter);
    document.getElementById("sliderWW").value = this.windowWidth;
    document.getElementById("sliderWC").value = this.windowCenter;

    this.updateSliceRangeUI();
    this.updateMetadataDisplay();
    this.syncRoiSizePx();
    this.syncTtfRoiSizePx();

    // Preserve custom manual ROI positions if available, otherwise update layout
    if (this.npsRoiPlacement === "manual" && this.npsRoiPositions && this.npsRoiPositions.length > 0) {
      this.extractRois();
      this.renderOriginalCanvas();
      this.renderTtfRoiCanvas();
      this.runAnalysis();
    } else {
      this.updateRoiLayout();
    }
  }

  generatePhantom() {
    this.dicomSeries = PhantomGenerator.generateSeries(20, 512, 0.625, 25.0);
    this.dicomFolderPath = "Synthetic_CT_Water_Phantom";

    this.currentViewIndex = 0;
    this.npsStartSliceIndex = 0;
    this.npsEndSliceIndex = this.dicomSeries.length - 1;
    this.ttfStartSliceIndex = 0;
    this.ttfEndSliceIndex = this.dicomSeries.length - 1;

    this.currentData = this.dicomSeries[0];
    this.windowCenter = 40.0;
    this.windowWidth = 400.0;

    document.getElementById("valWW").textContent = 400;
    document.getElementById("valWC").textContent = 40;
    document.getElementById("sliderWW").value = 400;
    document.getElementById("sliderWC").value = 40;

    this.updateSliceRangeUI();
    this.updateMetadataDisplay();
    this.syncRoiSizePx();
    this.syncTtfRoiSizePx();
    this.updateRoiLayout();
  }

  async handleProjectLoad(file) {
    if (!file) return;
    try {
      const proj = await ProjectManager.loadProjectFile(file);
      if (proj.mode) this.setPresetMode(proj.mode);

      if (proj.npsSettings) {
        this.npsStartSliceIndex = (proj.npsSettings.startSlice || 1) - 1;
        this.npsEndSliceIndex = (proj.npsSettings.endSlice || 1) - 1;
        this.npsRoiSizeMode = proj.npsSettings.roiSizeMode || "mm";
        this.npsRoiSizeMm = proj.npsSettings.roiSizeMm || 80;
        this.npsRoiPlacement = proj.npsSettings.roiPlacement || "center";
        this.npsMultiRoiCount = proj.npsSettings.multiRoiCount || 16;
      }

      if (proj.ttfSettings) {
        this.ttfStartSliceIndex = (proj.ttfSettings.startSlice || 1) - 1;
        this.ttfEndSliceIndex = (proj.ttfSettings.endSlice || 1) - 1;
        this.ttfRoiSizeMm = proj.ttfSettings.roiSizeMm || 40;
        this.ttfRoiPlacement = proj.ttfSettings.roiPlacement || "center";
      }

      if (proj.taskSettings) {
        if (proj.taskSettings.tasks && proj.taskSettings.tasks.length > 0) {
          this.taskDiameter = proj.taskSettings.tasks[0].diameter || 10;
          this.taskContrast = proj.taskSettings.tasks[0].contrast || 130;
        }
        this.observer = proj.taskSettings.observer || "NPW";
        this.commonNyquist = !!proj.taskSettings.commonNyquist;
      }

      this.updateSliceRangeUI();
      this.syncRoiSizePx();
      this.syncTtfRoiSizePx();
      this.updateRoiLayout();
      alert(`プロジェクト "${proj.projectName}" を読み込みました。`);
    } catch (e) {
      alert("プロジェクトファイルの読み込みに失敗しました。");
    }
  }

  updateSliceRangeUI() {
    const total = this.dicomSeries.length;
    document.getElementById("lblTotalSlices").textContent = `${total} スライス`;

    const startNpsIn = document.getElementById("startSliceInput");
    const endNpsIn = document.getElementById("endSliceInput");
    if (startNpsIn) startNpsIn.value = this.npsStartSliceIndex + 1;
    if (endNpsIn) endNpsIn.value = this.npsEndSliceIndex + 1;

    const startTtfIn = document.getElementById("startSliceTTF");
    const endTtfIn = document.getElementById("endSliceTTF");
    if (startTtfIn) startTtfIn.value = this.ttfStartSliceIndex + 1;
    if (endTtfIn) endTtfIn.value = this.ttfEndSliceIndex + 1;

    // Calculate Target Slice Counts for TTF and NPS
    const ttfCount = (total > 0) ? Math.max(0, this.ttfEndSliceIndex - this.ttfStartSliceIndex + 1) : 0;
    const npsCount = (total > 0) ? Math.max(0, this.npsEndSliceIndex - this.npsStartSliceIndex + 1) : 0;

    const lblTTF = document.getElementById("lblCountTTFSlices");
    if (lblTTF) lblTTF.textContent = `${ttfCount} 枚`;

    const lblNPS = document.getElementById("lblCountNPSSlices");
    if (lblNPS) lblNPS.textContent = `${npsCount} 枚`;

    const slider = document.getElementById("sliderViewSlice");
    if (slider) {
      slider.max = Math.max(1, total);
      slider.value = this.currentViewIndex + 1;
    }
    document.getElementById("valViewSlice").textContent = `${this.currentViewIndex + 1} / ${Math.max(1, total)}`;
  }

  updateMetadataDisplay() {
    if (!this.currentData) return;
    const d = this.currentData;

    document.getElementById("metaMatrix").textContent = `${d.width} x ${d.height}`;
    document.getElementById("metaPixelSize").textContent = `${d.pixelSize.toFixed(4)} mm`;
    document.getElementById("metaThickness").textContent = `${d.sliceThickness.toFixed(2)} mm`;
    document.getElementById("metaDfov").textContent = `${d.dfov.toFixed(1)} mm`;
    document.getElementById("metaKernel").textContent = d.kernel;
    document.getElementById("metaCtdi").textContent = (d.ctdiVol !== null && d.ctdiVol !== undefined && !isNaN(d.ctdiVol)) ? `${d.ctdiVol.toFixed(1)} mGy` : 'N/A';
    document.getElementById("metaSeries").textContent = `${d.seriesDesc} (${this.dicomSeries.length} Slices)`;
  }

  syncRoiSizePx() {
    if (!this.currentData) return;
    if (this.npsRoiSizeMode === "mm") {
      this.npsRoiSizePx = Math.round(this.npsRoiSizeMm / this.currentData.pixelSize);
    }
  }

  syncTtfRoiSizePx() {
    if (!this.currentData) return;
    if (this.ttfRoiSizeMode === "mm") {
      this.ttfRoiSizePx = Math.round(this.ttfRoiSizeMm / this.currentData.pixelSize);
    }
  }

  updateRoiSizeControls() {
    const label = document.getElementById("roiSizeLabel");
    const input = document.getElementById("roiSizeInput");
    if (this.npsRoiSizeMode === "mm") {
      if (label) label.textContent = "NPS ROI Size (mm)";
      if (input) input.value = this.npsRoiSizeMm;
    } else {
      if (label) label.textContent = "NPS ROI Size (pixels)";
      if (input) input.value = this.npsRoiSizePx;
    }
  }

  updateTtfRoiSizeControls() {
    const label = document.getElementById("ttfRoiSizeLabel");
    const input = document.getElementById("ttfRoiSizeInput");
    if (this.ttfRoiSizeMode === "mm") {
      if (label) label.textContent = "TTF ROI Size (mm)";
      if (input) input.value = this.ttfRoiSizeMm;
    } else {
      if (label) label.textContent = "TTF ROI Size (pixels)";
      if (input) input.value = this.ttfRoiSizePx;
    }
  }

  updateRoiLayout() {
    if (!this.currentData) return;
    const { width, height } = this.currentData;

    // 1. NPS ROI Positions
    this.npsRoiPositions = [];
    const halfNps = Math.floor(this.npsRoiSizePx / 2);

    if (this.npsRoiPlacement === "center") {
      this.npsRoiPositions.push({ x: Math.floor(width / 2), y: Math.floor(height / 2) });
    } else if (this.npsRoiPlacement === "multi") {
      const count = this.npsMultiRoiCount;
      const margin = halfNps + 10;
      const radius = Math.min(width, height) / 2.0 - margin - 20;
      const centerX = width / 2;
      const centerY = height / 2;

      for (let i = 0; i < count; i++) {
        const angle = (2.0 * Math.PI * i) / count;
        const r = (i % 2 === 0) ? radius : radius * 0.65;
        const x = Math.round(centerX + r * Math.cos(angle));
        const y = Math.round(centerY + r * Math.sin(angle));
        this.npsRoiPositions.push({ x, y });
      }
    } else {
      if (this.npsRoiPositions.length === 0) {
        this.npsRoiPositions.push({ x: Math.floor(width / 2), y: Math.floor(height / 2) });
      }
    }

    // 2. TTF ROI Position
    if (this.ttfRoiPlacement === "center" || this.ttfRoiPositions.length === 0) {
      this.ttfRoiPositions = [{ x: Math.floor(width / 2), y: Math.floor(height / 2) }];
    }

    this.extractRois();
    this.renderAllCanvases();
    this.runAnalysis();
  }

  /**
   * Extract ROI Pixel Data arrays for both NPS (noise ROIs) and TTF (rod ROIs)
   */
  extractRois() {
    if (this.dicomSeries.length === 0) return;
    if (!this.currentData) this.currentData = this.dicomSeries[0];

    const { width: imgW, height: imgH } = this.currentData;

    // Ensure fallback ROI positions exist if empty
    if (!this.npsRoiPositions || this.npsRoiPositions.length === 0) {
      this.npsRoiPositions = [{ x: Math.floor(imgW / 2), y: Math.floor(imgH / 2) }];
    }
    if (!this.ttfRoiPositions || this.ttfRoiPositions.length === 0) {
      this.ttfRoiPositions = [{ x: Math.floor(imgW / 2), y: Math.floor(imgH / 2) }];
    }

    // 1. Extract NPS ROIs
    if (this.npsRoiPositions.length > 0) {
      const npsSize = this.npsRoiSizePx;
      const halfNps = Math.floor(npsSize / 2);
      this.extractedNpsRois = [];
      const npsStart = Math.min(this.npsStartSliceIndex, this.dicomSeries.length - 1);
      const npsEnd = Math.min(this.npsEndSliceIndex, this.dicomSeries.length - 1);

      for (let s = npsStart; s <= npsEnd; s++) {
        const slice = this.dicomSeries[s];
        if (!slice) continue;
        const { pixelArray, width, height } = slice;

        for (const pos of this.npsRoiPositions) {
          const roi = new Float32Array(npsSize * npsSize);
          const startX = pos.x - halfNps;
          const startY = pos.y - halfNps;

          for (let ry = 0; ry < npsSize; ry++) {
            const imgY = Math.max(0, Math.min(height - 1, startY + ry));
            for (let rx = 0; rx < npsSize; rx++) {
              const imgX = Math.max(0, Math.min(width - 1, startX + rx));
              roi[ry * npsSize + rx] = pixelArray[imgY * width + imgX];
            }
          }
          this.extractedNpsRois.push(roi);
        }
      }
    }

    // 2. Extract TTF ROIs
    if (this.ttfRoiPositions.length > 0) {
      const ttfSize = this.ttfRoiSizePx;
      const halfTtf = Math.floor(ttfSize / 2);
      this.extractedTtfRois = [];
      const ttfStart = Math.min(this.ttfStartSliceIndex, this.dicomSeries.length - 1);
      const ttfEnd = Math.min(this.ttfEndSliceIndex, this.dicomSeries.length - 1);

      for (let s = ttfStart; s <= ttfEnd; s++) {
        const slice = this.dicomSeries[s];
        if (!slice) continue;
        const { pixelArray, width, height } = slice;

        for (const pos of this.ttfRoiPositions) {
          const roi = new Float32Array(ttfSize * ttfSize);
          const startX = pos.x - halfTtf;
          const startY = pos.y - halfTtf;

          for (let ry = 0; ry < ttfSize; ry++) {
            const imgY = Math.max(0, Math.min(height - 1, startY + ry));
            for (let rx = 0; rx < ttfSize; rx++) {
              const imgX = Math.max(0, Math.min(width - 1, startX + rx));
              roi[ry * ttfSize + rx] = pixelArray[imgY * width + imgX];
            }
          }
          this.extractedTtfRois.push(roi);
        }
      }
    }

    const totalActiveRois = this.extractedNpsRois.length;
    const badge = document.getElementById("roiCountBadge");
    if (badge) badge.textContent = `${totalActiveRois} ROIs (${this.npsRoiPositions.length}/slice)`;
    this.renderRoiZoomCanvas();
  }

  /**
   * Execute NPS, TTF, and Detectability Calculation Pipeline
   */
  runAnalysis() {
    if (!this.currentData || this.extractedNpsRois.length === 0) return;

    const npsSize = this.npsRoiSizePx;
    const npsFftSize = FFT2D.nextPowerOf2(npsSize);
    const pixelSize = this.currentData.pixelSize;
    const numNpsRois = this.extractedNpsRois.length;

    // 1. Calculate NPS
    try {
      const avg2DNps = new Float32Array(npsFftSize * npsFftSize);
      for (let r = 0; r < numNpsRois; r++) {
        const roiPixels = this.extractedNpsRois[r];
        const trendRemoved = TrendRemoval.process(roiPixels, npsSize, this.trendMethod);
        const { windowedPixels, meanSquareRatio } = Windowing.apply(trendRemoved, npsSize, this.windowType);
        const nps2D = FFT2D.computeNps2D(windowedPixels, npsSize, pixelSize, meanSquareRatio);

        for (let i = 0; i < nps2D.length; i++) {
          avg2DNps[i] += nps2D[i] / numNpsRois;
        }
      }

      this.npsResult = RadialNps.process(avg2DNps, npsFftSize, pixelSize, this.binWidth, this.excludeDC);
      this.npsResult.nps2DMatrix = avg2DNps;
      this.npsResult.roiSize = npsFftSize;
      this.npsResult.label = `${this.mode.toUpperCase()} (${this.npsRoiSizeMm}mm, ${numNpsRois} ROIs)`;
    } catch (e) {
      console.warn("NPS calculation notice:", e);
    }

    // 2. Calculate TTF (using independent ttfRoiSizePx and extractedTtfRois)
    try {
      if (this.extractedTtfRois.length > 0) {
        const ttfSize = this.ttfRoiSizePx;
        this.ttfResult = TTFAnalysis.process(this.extractedTtfRois, ttfSize, pixelSize, {
          isResearchMode: this.mode === "research"
        });
      }
    } catch (e) {
      console.warn("TTF calculation notice:", e);
      this.ttfResult = null;
    }

    // 3. Calculate Task-based Detectability Index (d') for Task ① and Task ②
    try {
      if (this.npsResult && this.ttfResult) {
        const task1Def = { diameter: this.taskDiameter, contrast: this.taskContrast };
        this.detectabilityResult = DetectabilityAnalysis.compute(this.ttfResult, this.npsResult, task1Def, {
          observer: this.observer,
          commonNyquist: this.commonNyquist,
          specFMin: this.specFMin,
          specFMax: this.specFMax,
          isResearchMode: this.mode === "research"
        });

        if (this.task2Enabled) {
          const task2Def = { diameter: this.task2Diameter, contrast: this.task2Contrast };
          this.detectabilityResult2 = DetectabilityAnalysis.compute(this.ttfResult, this.npsResult, task2Def, {
            observer: this.observer,
            commonNyquist: this.commonNyquist,
            specFMin: this.specFMin,
            specFMax: this.specFMax,
            isResearchMode: this.mode === "research"
          });
        } else {
          this.detectabilityResult2 = null;
        }

        this.detectabilityResults = [{ ...task1Def, dPrime: this.detectabilityResult.dPrime }];
        if (this.detectabilityResult2) {
          this.detectabilityResults.push({ diameter: this.task2Diameter, contrast: this.task2Contrast, dPrime: this.detectabilityResult2.dPrime });
        }
      }
    } catch (e) {
      console.warn("Detectability calculation notice:", e);
      this.detectabilityResult = null;
      this.detectabilityResult2 = null;
    }

    // 4. Update UI Displays & Canvases & Charts
    this.updateMetricBadges();
    this.renderResultTable();
    if (this.npsResult) this.chartManager.renderMainChart(this.npsResult);
    if (this.ttfResult) this.chartManager.renderTtfChart("chartTTF", this.ttfResult);
    if (this.detectabilityResult) {
      this.chartManager.renderDPrimeBreakdownSuite(this.detectabilityResult, this.detectabilityResult2);
    }
    this.render2DNpsCanvas();
  }

  async runBootstrap() {
    if (!this.extractedNpsRois.length) return;
    const btn = document.getElementById("btnRunBootstrap");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Bootstrap 計算中..."; }

    try {
      const BE = (typeof window !== 'undefined' && window.BootstrapEngine)
        ? window.BootstrapEngine
        : ((typeof BootstrapEngine !== 'undefined') ? BootstrapEngine : null);

      if (!BE) {
        throw new Error("BootstrapEngine モジュールが読み込まれていません。ブラウザを再読み込み (Ctrl+F5) してください。");
      }

      this.bootstrapResult = await BE.run(this.extractedTtfRois, this.extractedNpsRois, {
        npsRoiSize: this.npsRoiSizePx,
        ttfRoiSize: this.ttfRoiSizePx,
        pixelSize: this.currentData ? this.currentData.pixelSize : 0.625,
        iterations: this.bootstrapIterations,
        ttfParams: this.ttfResult ? {
          isBrightRod: this.ttfResult.isBrightRod,
          refRPeak: this.ttfResult.rPeak
        } : {},
        taskDef: { diameter: this.taskDiameter, contrast: this.taskContrast },
        task2Def: this.task2Enabled ? { diameter: this.task2Diameter, contrast: this.task2Contrast } : null,
        detectabilityOptions: {
          observer: this.observer,
          commonNyquist: this.commonNyquist,
          specFMin: this.specFMin,
          specFMax: this.specFMax
        }
      }, (pct) => {
        if (btn) btn.textContent = `⏳ Bootstrap 計算中 (${Math.round(pct * 100)}%)`;
      });

      if (this.npsResult && this.bootstrapResult.npsCI) {
        this.npsResult.npsLower95 = Array.from(this.bootstrapResult.npsCI.lower);
        this.npsResult.npsUpper95 = Array.from(this.bootstrapResult.npsCI.upper);
      }

      if (this.ttfResult && this.bootstrapResult.ttfCI) {
        this.ttfResult.ttfLower95 = Array.from(this.bootstrapResult.ttfCI.lower);
        this.ttfResult.ttfUpper95 = Array.from(this.bootstrapResult.ttfCI.upper);
      }

      if (this.detectabilityResults && this.detectabilityResults.length > 0) {
        this.detectabilityResults[0].dPrimeCI = this.bootstrapResult.dPrimeCI;
      }

      this.updateMetricBadges();
      this.renderResultTable();
      if (this.npsResult) this.chartManager.renderMainChart(this.npsResult);
      if (this.ttfResult) this.chartManager.renderTtfChart("chartTTF", this.ttfResult);
      if (this.detectabilityResult) {
        this.chartManager.renderDPrimeBreakdownSuite(this.detectabilityResult, this.detectabilityResult2);
      }
      alert(`Bootstrap ${this.bootstrapIterations} 回の計算が正常に完了しました。`);
    } catch (e) {
      alert("Bootstrap 計算エラー: " + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "⚡ 統合 Bootstrap 解析実行 (TTF, NPS, d')"; }
    }
  }

  updateMetricBadges() {
    if (this.npsResult) {
      document.getElementById("metricSd").textContent = this.npsResult.stdDevHU.toFixed(2);
      document.getElementById("metricNpsIntegral").textContent = this.npsResult.npsIntegral.toExponential(3);
      document.getElementById("metricFPeak").textContent = `${this.npsResult.fPeak.toFixed(3)} / ${this.npsResult.fAve.toFixed(3)}`;

      if (this.bootstrapResult && this.bootstrapResult.sdCI) {
        const sdCiEl = document.getElementById("metricSdCI");
        if (sdCiEl) sdCiEl.textContent = `[ ${this.bootstrapResult.sdCI[0].toFixed(2)} ~ ${this.bootstrapResult.sdCI[1].toFixed(2)} ]`;
      }
    }
    if (this.ttfResult) {
      document.getElementById("metricF50").textContent = `${this.ttfResult.f50.toFixed(3)} / ${this.ttfResult.f10.toFixed(3)} / ${this.ttfResult.f5.toFixed(3)}`;
      document.getElementById("valF50").textContent = this.ttfResult.f50.toFixed(3);
      document.getElementById("valF10").textContent = this.ttfResult.f10.toFixed(3);
      document.getElementById("valF5").textContent = this.ttfResult.f5.toFixed(3);

      if (this.bootstrapResult) {
        document.getElementById("valF50Low").textContent = this.bootstrapResult.f50CI[0].toFixed(3);
        document.getElementById("valF50High").textContent = this.bootstrapResult.f50CI[1].toFixed(3);
        document.getElementById("valF10Low").textContent = this.bootstrapResult.f10CI[0].toFixed(3);
        document.getElementById("valF10High").textContent = this.bootstrapResult.f10CI[1].toFixed(3);
        document.getElementById("valF5Low").textContent = this.bootstrapResult.f5CI[0].toFixed(3);
        document.getElementById("valF5High").textContent = this.bootstrapResult.f5CI[1].toFixed(3);
      }
    }
    if (this.detectabilityResult) {
      const dNyq = this.detectabilityResult.dPrimeNyquist || this.detectabilityResult.dPrime;
      const dSpec = this.detectabilityResult.dPrimeSpecified || 0;

      const metricEl = document.getElementById("metricDPrime");
      if (metricEl) metricEl.textContent = dNyq.toFixed(2);
      const metricSpecEl = document.getElementById("metricDPrimeSpec");
      if (metricSpecEl) metricSpecEl.textContent = dSpec.toFixed(2);

      // Task 1 Card Update
      const cardEl = document.getElementById("cardDPrimeVal");
      if (cardEl) cardEl.textContent = dNyq.toFixed(2);
      const cardSpecEl = document.getElementById("cardDPrimeSpecVal");
      if (cardSpecEl) cardSpecEl.textContent = dSpec.toFixed(2);

      const p1El = document.getElementById("valTask1ParamsDisplay");
      if (p1El) p1El.textContent = `D=${this.taskDiameter.toFixed(1)}mm, ΔHU=${this.taskContrast.toFixed(0)}`;
      const obs1El = document.getElementById("valObserver1Display");
      if (obs1El) obs1El.textContent = this.observer || "NPW";

      const lblNyqEl = document.getElementById("lblNyqRangeDisplay");
      if (lblNyqEl) lblNyqEl.textContent = `0.010~${(this.detectabilityResult.fUpper || 0.76).toFixed(3)}`;
      const lblSpecEl = document.getElementById("lblSpecRangeDisplay");
      if (lblSpecEl) lblSpecEl.textContent = `${this.specFMin.toFixed(3)}~${this.specFMax.toFixed(3)}`;

      // Task 2 Card Update
      const card2Container = document.getElementById("cardTask2Container");
      if (card2Container) card2Container.style.display = this.task2Enabled ? "block" : "none";

      if (this.task2Enabled && this.detectabilityResult2) {
        const d2Nyq = this.detectabilityResult2.dPrimeNyquist || this.detectabilityResult2.dPrime;
        const d2Spec = this.detectabilityResult2.dPrimeSpecified || 0;

        const card2El = document.getElementById("cardDPrime2Val");
        if (card2El) card2El.textContent = d2Nyq.toFixed(2);
        const card2SpecEl = document.getElementById("cardDPrime2SpecVal");
        if (card2SpecEl) card2SpecEl.textContent = d2Spec.toFixed(2);

        const p2El = document.getElementById("valTask2ParamsDisplay");
        if (p2El) p2El.textContent = `D=${this.task2Diameter.toFixed(1)}mm, ΔHU=${this.task2Contrast.toFixed(0)}`;
        const obs2El = document.getElementById("valObserver2Display");
        if (obs2El) obs2El.textContent = this.observer || "NPW";

        const lblNyq2El = document.getElementById("lblNyqRangeDisplay2");
        if (lblNyq2El) lblNyq2El.textContent = `0.010~${(this.detectabilityResult2.fUpper || 0.76).toFixed(3)}`;
        const lblSpec2El = document.getElementById("lblSpecRangeDisplay2");
        if (lblSpec2El) lblSpec2El.textContent = `${this.specFMin.toFixed(3)}~${this.specFMax.toFixed(3)}`;
      }

      if (this.bootstrapResult) {
        if (this.bootstrapResult.dPrimeNyqCI) {
          const ciEl = document.getElementById("cardDPrimeCI");
          if (ciEl) ciEl.textContent = `[ ${this.bootstrapResult.dPrimeNyqCI[0].toFixed(2)} ~ ${this.bootstrapResult.dPrimeNyqCI[1].toFixed(2)} ]`;
        }
        if (this.bootstrapResult.dPrimeSpecCI) {
          const ciSpecEl = document.getElementById("cardDPrimeSpecCI");
          if (ciSpecEl) ciSpecEl.textContent = `[ ${this.bootstrapResult.dPrimeSpecCI[0].toFixed(2)} ~ ${this.bootstrapResult.dPrimeSpecCI[1].toFixed(2)} ]`;
        }

        if (this.task2Enabled && this.bootstrapResult.dPrime2NyqCI) {
          const ci2El = document.getElementById("cardDPrime2CI");
          if (ci2El) ci2El.textContent = `[ ${this.bootstrapResult.dPrime2NyqCI[0].toFixed(2)} ~ ${this.bootstrapResult.dPrime2NyqCI[1].toFixed(2)} ]`;
        }
        if (this.task2Enabled && this.bootstrapResult.dPrime2SpecCI) {
          const ci2SpecEl = document.getElementById("cardDPrime2SpecCI");
          if (ci2SpecEl) ci2SpecEl.textContent = `[ ${this.bootstrapResult.dPrime2SpecCI[0].toFixed(2)} ~ ${this.bootstrapResult.dPrime2SpecCI[1].toFixed(2)} ]`;
        }
      }
    }
  }

  renderResultTable() {
    const tbody = document.getElementById("resultTableBody");
    if (tbody && this.npsResult) {
      tbody.innerHTML = "";
      const freqs = this.npsResult.frequencies;
      const nps = this.npsResult.nps1D;
      const low = this.npsResult.npsLower95;
      const high = this.npsResult.npsUpper95;

      for (let i = 0; i < freqs.length; i++) {
        const tr = document.createElement("tr");
        const lowVal = (low && low[i] !== undefined) ? low[i].toExponential(3) : "-";
        const highVal = (high && high[i] !== undefined) ? high[i].toExponential(3) : "-";
        tr.innerHTML = `
          <td>${freqs[i].toFixed(3)}</td>
          <td>${nps[i].toExponential(4)}</td>
          <td>${lowVal}</td>
          <td>${highVal}</td>
        `;
        tbody.appendChild(tr);
      }
    }
    this.renderTtfSpectralTable();
  }

  renderTtfSpectralTable() {
    const tbody = document.getElementById("ttfSpectralTableBody");
    if (!tbody || !this.ttfResult) return;
    tbody.innerHTML = "";

    const freqs = this.ttfResult.frequencies;
    const ttf = this.ttfResult.ttf;
    const low = this.ttfResult.ttfLower95;
    const high = this.ttfResult.ttfUpper95;

    const step = Math.max(1, Math.floor(freqs.length / 100));

    for (let i = 0; i < freqs.length; i += step) {
      const tr = document.createElement("tr");
      const lowVal = (low && low[i] !== undefined) ? low[i].toFixed(4) : "-";
      const highVal = (high && high[i] !== undefined) ? high[i].toFixed(4) : "-";
      tr.innerHTML = `
        <td>${freqs[i].toFixed(3)}</td>
        <td>${ttf[i].toFixed(4)}</td>
        <td>${lowVal}</td>
        <td>${highVal}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  renderAllCanvases() {
    this.renderOriginalCanvas();
    this.renderRoiZoomCanvas();
    this.renderTtfRoiCanvas();
    this.render2DNpsCanvas();
  }

  renderOriginalCanvas() {
    const canvas = document.getElementById("canvasOriginal");
    if (!canvas || !this.currentData) return;

    const { width, height, pixelArray } = this.currentData;
    if (!width || !height || !pixelArray) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    const ww = Math.max(1, this.windowWidth || 400);
    const wc = (this.windowCenter !== undefined && !isNaN(this.windowCenter)) ? this.windowCenter : 40;
    const minHu = wc - ww / 2;
    const maxHu = wc + ww / 2;
    const range = (maxHu - minHu) || 1.0;

    for (let i = 0; i < pixelArray.length; i++) {
      const hu = pixelArray[i];
      let norm = (hu - minHu) / range;
      norm = Math.max(0, Math.min(1, norm));
      const val = Math.round(norm * 255);
      const idx = i * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    // 1. Draw NPS ROI boxes (Cyan)
    const npsSize = Math.max(4, Math.round(this.npsRoiSizePx) || 64);
    const halfNps = Math.floor(npsSize / 2);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = Math.max(1.5, width / 512);

    if (this.npsRoiPositions && Array.isArray(this.npsRoiPositions)) {
      for (const pos of this.npsRoiPositions) {
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
          ctx.strokeRect(pos.x - halfNps, pos.y - halfNps, npsSize, npsSize);
        }
      }
    }

    // 2. Draw TTF Rod ROI box (Purple)
    const ttfSize = Math.max(4, Math.round(this.ttfRoiSizePx) || 64);
    const halfTtf = Math.floor(ttfSize / 2);
    ctx.strokeStyle = "#c084fc";
    ctx.lineWidth = Math.max(2.0, width / 512);

    if (this.ttfRoiPositions && Array.isArray(this.ttfRoiPositions)) {
      for (const pos of this.ttfRoiPositions) {
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
          ctx.strokeRect(pos.x - halfTtf, pos.y - halfTtf, ttfSize, ttfSize);
          ctx.fillStyle = "#c084fc";
          ctx.font = "11px sans-serif";
          ctx.fillText("TTF Rod", pos.x - halfTtf, Math.max(12, pos.y - halfTtf - 4));
        }
      }
    }
  }

  renderRoiZoomCanvas() {
    const canvas = document.getElementById("canvasRoiZoom");
    if (!canvas || !this.currentData) return;

    const roiSize = Math.max(4, Math.round(this.npsRoiSizePx) || 64);
    canvas.width = roiSize;
    canvas.height = roiSize;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let targetRoi = null;
    if (this.extractedNpsRois && this.extractedNpsRois.length > 0) {
      targetRoi = this.extractedNpsRois[0];
    } else {
      // Fallback: extract single ROI from current slice center if extractRois has not run yet
      const { pixelArray, width, height } = this.currentData;
      if (pixelArray && width && height) {
        targetRoi = new Float32Array(roiSize * roiSize);
        const halfNps = Math.floor(roiSize / 2);
        const pos = (this.npsRoiPositions && this.npsRoiPositions.length > 0) ? this.npsRoiPositions[0] : { x: Math.floor(width / 2), y: Math.floor(height / 2) };
        const startX = pos.x - halfNps;
        const startY = pos.y - halfNps;
        for (let ry = 0; ry < roiSize; ry++) {
          const imgY = Math.max(0, Math.min(height - 1, startY + ry));
          for (let rx = 0; rx < roiSize; rx++) {
            const imgX = Math.max(0, Math.min(width - 1, startX + rx));
            targetRoi[ry * roiSize + rx] = pixelArray[imgY * width + imgX];
          }
        }
      }
    }

    if (!targetRoi || targetRoi.length !== roiSize * roiSize) return;

    const imgData = ctx.createImageData(roiSize, roiSize);
    const data = imgData.data;

    const ww = Math.max(1, this.windowWidth || 400);
    const wc = (this.windowCenter !== undefined && !isNaN(this.windowCenter)) ? this.windowCenter : 40;
    const minHu = wc - ww / 2;
    const maxHu = wc + ww / 2;
    const range = (maxHu - minHu) || 1.0;

    for (let i = 0; i < targetRoi.length; i++) {
      const hu = targetRoi[i];
      let norm = (hu - minHu) / range;
      norm = Math.max(0, Math.min(1, norm));
      const val = Math.round(norm * 255);
      const idx = i * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  renderTtfRoiCanvas() {
    const canvas = document.getElementById("canvasTtfRoi");
    if (!canvas || !this.currentData) return;

    const roiSize = Math.max(4, Math.round(this.ttfRoiSizePx) || 64);
    canvas.width = roiSize;
    canvas.height = roiSize;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { pixelArray, width, height } = this.currentData;
    if (!pixelArray || !width || !height) return;

    const pos = (this.ttfRoiPositions && this.ttfRoiPositions.length > 0) ? this.ttfRoiPositions[0] : { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    const halfTtf = Math.floor(roiSize / 2);

    const ttfRoi = new Float32Array(roiSize * roiSize);
    const startX = pos.x - halfTtf;
    const startY = pos.y - halfTtf;

    for (let ry = 0; ry < roiSize; ry++) {
      const imgY = Math.max(0, Math.min(height - 1, startY + ry));
      for (let rx = 0; rx < roiSize; rx++) {
        const imgX = Math.max(0, Math.min(width - 1, startX + rx));
        ttfRoi[ry * roiSize + rx] = pixelArray[imgY * width + imgX];
      }
    }

    let minHu = Infinity, maxHu = -Infinity;
    for (let i = 0; i < ttfRoi.length; i++) {
      if (ttfRoi[i] < minHu) minHu = ttfRoi[i];
      if (ttfRoi[i] > maxHu) maxHu = ttfRoi[i];
    }
    const range = (maxHu - minHu) || 1.0;

    const imgData = ctx.createImageData(roiSize, roiSize);
    const data = imgData.data;

    for (let i = 0; i < ttfRoi.length; i++) {
      const hu = ttfRoi[i];
      let norm = (hu - minHu) / range;
      norm = Math.max(0, Math.min(1, norm));
      const val = Math.round(norm * 255);
      const idx = i * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    // Overlay detected Rod Centroid marker (+) and circle
    if (this.ttfResult && this.ttfResult.centroid) {
      const { x: cx, y: cy } = this.ttfResult.centroid;

      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(cx + 6, cy);
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx, cy + 6);
      ctx.stroke();

      const approxRadius = Math.min(roiSize * 0.25, 14);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.arc(cx, cy, approxRadius, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  render2DNpsCanvas() {
    const canvas = document.getElementById("canvas2DNps");
    if (!canvas || !this.npsResult || !this.npsResult.nps2DMatrix) return;

    const matrix = this.npsResult.nps2DMatrix;
    const size = Math.max(4, Math.round(this.npsResult.roiSize) || 64);

    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    let maxVal = -Infinity;
    for (let i = 0; i < matrix.length; i++) {
      const val = Math.log10(matrix[i] + 1.0);
      if (val > maxVal) maxVal = val;
    }

    for (let i = 0; i < matrix.length; i++) {
      const val = Math.log10(matrix[i] + 1.0);
      const norm = maxVal > 0 ? Math.max(0, Math.min(1, val / maxVal)) : 0;
      const idx = i * 4;
      data[idx] = Math.round(Math.min(255, norm * 2.0 * 255));
      data[idx + 1] = Math.round(Math.max(0, (norm - 0.5) * 2.0 * 255));
      data[idx + 2] = Math.round(Math.max(0, (norm - 0.8) * 5.0 * 255));
      data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }
}

// Global Instant Initialization
window.addEventListener("DOMContentLoaded", () => {
  window.app = new AppController();
});
