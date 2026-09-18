# CT Task-Based Image Quality Analysis

This repository contains the analysis code used for the task-based image-quality
assessment reported in the manuscript:

**“Physical image quality of normal- and super-resolution deep learning
reconstruction in lung CT: A task-based phantom study”**

The source code is provided to improve transparency and reproducibility of the
quantitative analyses reported in the manuscript.

---

## Overview

The analysis pipeline consists of three main components:

1. Task transfer function (TTF) analysis
2. Noise power spectrum (NPS) analysis
3. Task-based detectability index (d′) analysis

A unified bootstrap procedure is additionally implemented to estimate
95% confidence intervals (CIs) for the quantitative measurements.

---

## 1. Task Transfer Function (TTF)

TTF was calculated from a circular acrylic insert in a water background.

The main processing steps were:

- Estimation of the center of the circular insert
- Radial edge-spread function (ESF) sampling
- Sub-pixel radial sampling with an interval of **0.05 mm**
- Generation of the line-spread function (LSF) using a signed derivative
- Application of a Tukey taper window
- 2048-point zero-padded one-dimensional FFT
- Calculation of TTF as a function of spatial frequency
- Interpolation of the frequencies corresponding to 50%, 10%, and 5% TTF

For the study, **110 consecutive images** were used for each condition.
The number of images was selected to avoid possible effects from the edge
regions of the phantom.

Relevant source files:

- `ttfAnalysis.js`
- `fft2d.js`

---

## 2. Noise Power Spectrum (NPS)

NPS was calculated from a square region of interest placed at the center of
the uniform phantom region.

For the analyses reported in the revised manuscript, a physically matched
**80 × 80 mm ROI** was used for all reconstruction conditions.

The main processing steps were:

- Extraction of the central ROI
- Mean subtraction for trend removal
- No additional window function (rectangular window)
- Two-dimensional FFT
- Calculation of the two-dimensional NPS
- Radial averaging to obtain the one-dimensional NPS
- Radial frequency bin width of **0.01 cycles/mm**

The same **110 images** used for the TTF analysis were used for the NPS
analysis.

Relevant source files:

- `trendRemoval.js`
- `windowing.js`
- `fft2d.js`
- `radialNps.js`

---

## 3. Task-Based Detectability Index (d′)

Task-based detectability was evaluated using a **non-prewhitening (NPW)
observer model**.

Two circular detection tasks were evaluated:

- **10-mm diameter / 130-HU contrast**
- **3-mm diameter / 130-HU contrast**

The task spectrum was calculated using the Fourier transform of a circular
disk task based on the Bessel-function formulation.

TTF, NPS, and the task spectrum were combined to calculate the
frequency-dependent contribution to NPW detectability and the resulting d′.

The lower integration frequency was set to:

- **0.01 cycles/mm**

Two upper-frequency settings were evaluated:

1. The maximum available frequency range supported by the TTF and NPS data
2. A common upper-frequency limit of **0.8 cycles/mm**

The common upper-frequency limit of 0.8 cycles/mm was specified at runtime
using the user-defined frequency-range setting. This additional analysis was
performed to compare reconstruction conditions over an identical spatial-
frequency range.

Relevant source files:

- `taskFunction.js`
- `detectability.js`

---

## 4. Bootstrap Confidence Intervals

A unified bootstrap resampling procedure was implemented to estimate
measurement uncertainty.

For each bootstrap iteration, the image samples were resampled with
replacement, and TTF, NPS, and d′ were recalculated through the corresponding
analysis pipeline.

The **95% confidence intervals** were determined using the percentile method,
defined by the **2.5th and 97.5th percentiles** of the bootstrap distributions.

For the analyses reported in the manuscript, **500 bootstrap iterations**
were used.

Relevant source file:

- `bootstrapEngine.js`

---

## Study-Specific Analysis Settings

The principal analysis settings used for the revised manuscript were:

| Parameter | Setting |
|---|---|
| Number of images per condition | 110 |
| NPS ROI | 80 × 80 mm |
| NPS trend removal | Mean subtraction |
| NPS window | None (rectangular) |
| NPS radial bin width | 0.01 cycles/mm |
| Observer model | NPW |
| Detection task 1 | 10 mm / 130 HU |
| Detection task 2 | 3 mm / 130 HU |
| Lower integration frequency for d′ | 0.01 cycles/mm |
| Additional common upper-frequency limit | 0.8 cycles/mm |
| Bootstrap iterations | 500 |
| Confidence interval | 95% percentile CI |

The 0.8 cycles/mm upper-frequency limit was specified at runtime rather than
being used as the default application setting.

---

## Source-Code Organization

```text
js/
├── app.js                  # Analysis workflow and parameter handling
├── ttfAnalysis.js          # TTF calculation
├── trendRemoval.js         # NPS trend removal
├── windowing.js            # NPS window handling
├── fft2d.js                # FFT and 2D NPS calculation
├── radialNps.js            # Radial NPS averaging
├── taskFunction.js         # Task-spectrum calculation
├── detectability.js        # NPW detectability calculation
└── bootstrapEngine.js      # Bootstrap resampling and confidence intervals
```

---

## Notes on the Study Implementation

The code in this repository corresponds to the analysis procedures used for
the revised manuscript.

This repository contains the computational components relevant to the
quantitative analyses reported in the manuscript. User-interface,
visualization, file-management, and other application components that are not
required to describe the quantitative analysis procedures are not included.

TTF was measured using an acrylic insert in a water background. Because
deep-learning reconstruction can exhibit nonlinear, contrast-dependent, and
background-dependent behavior, these TTF measurements may not directly
represent spatial-resolution characteristics in aerated lung parenchyma.

The repository is intended primarily to document the computational procedures
used in the study and to facilitate methodological review and reproducibility.

---

## Citation

If this code is used in academic work, please cite the associated manuscript:

**Takada K, et al.**  
*Physical image quality of normal- and super-resolution deep learning
reconstruction in lung CT: A task-based phantom study.*

Citation information will be updated after publication.

---

## Disclaimer

This software was developed for research purposes and was used for the
phantom-based image-quality analyses described in the associated manuscript.

It is not intended for clinical diagnosis or clinical decision-making.
