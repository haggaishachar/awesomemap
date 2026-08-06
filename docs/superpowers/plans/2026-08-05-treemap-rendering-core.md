# Treemap Rendering Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing static `data-science` dataset into a real, interactive, zoomable treemap (categories as drill-down regions, leaves as logo boxes sized by weight, click-through detail panel), served as clean-URL static pages ready for Firebase Hosting.

**Architecture:** A single-page static app with no build step. `d3-hierarchy`'s treemap layout (vendored as plain ES module source, loaded via an import map — no bundler) computes nested rectangles from `data.json` once; a small renderer projects the currently-focused node's rectangle to fill the viewport so "zooming into a category" is just re-rendering with a new focus. A tiny router reads the URL path (no query strings) to pick which map's data to load.

**Tech Stack:** Vanilla JS (ES modules), `d3-hierarchy` (vendored, MIT), plain CSS, Node's built-in test runner (`node --test`), Firebase Hosting.

## Global Constraints

- No backend in this plan: no Firestore, no Auth, no Firebase Functions — Hosting only. (Spec: Non-goals)
- No bundler. Browser code is loaded as native ES modules; third-party code is vendored as real ESM source, not a UMD/CDN script tag. (Spec: Architecture)
- URLs must be clean: no `.html` extension, no query strings (e.g. `/data-science`, not `/data-science.html?map=...`). (Spec: Architecture)
- A leaf with no `weight` field must default to `1` rather than break layout or throw. (Spec: Data schema, Error handling)
- Pure/testable logic uses Node's built-in test runner (`node --test`) — no Jest/Mocha/etc. added as a dependency. (Spec: Testing)
- `to_html.js` and the top-level `data-science.html` are retired; `data-science/` at the repo root is replaced by `public/data/data-science/`. (Spec: File layout)

---

### Task 1: Repo scaffolding, toolchain, and data migration

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `public/data/data-science/data.json`
- Create: `public/data/data-science/images/*` (moved from `data-science/images/`)
- Create: `public/vendor/d3-hierarchy/` (vendored ESM source of `d3-hierarchy@3.1.2`)
- Delete: `to_html.js`, `data-science.html`, `data-science/` (old top-level folder, after its contents are migrated)

**Interfaces:**
- Produces: `public/data/data-science/data.json` with the schema `{ id, name1, children? }` for categories and `{ id, name1, image, link, desc, gh, weight }` for leaves — every later task reads this shape.
- Produces: `public/vendor/d3-hierarchy/index.js` importable as the bare specifier `"d3-hierarchy"` from both Node (via `node_modules`) and the browser (via an import map added in Task 3).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "techmap",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "vendor:d3": "rm -rf public/vendor/d3-hierarchy && mkdir -p public/vendor && cp -r node_modules/d3-hierarchy/src public/vendor/d3-hierarchy",
    "dev": "npx --yes serve public -l 5000"
  },
  "dependencies": {
    "d3-hierarchy": "3.1.2"
  }
}
```

- [ ] **Step 2: Install the dependency and vendor it for the browser**

Run:
```bash
npm install
npm run vendor:d3
```

Expected: `node_modules/d3-hierarchy` exists, and `public/vendor/d3-hierarchy/index.js` exists (it's a straight copy of `d3-hierarchy`'s ESM source — zero runtime dependencies of its own, so no other files need vendoring).

- [ ] **Step 3: Add `.gitignore`**

```
node_modules/
```

- [ ] **Step 4: Migrate the images**

```bash
mkdir -p public/data/data-science/images
git mv data-science/images/* public/data/data-science/images/
```

- [ ] **Step 5: Write the migrated `data.json`**

This is the existing dataset with a `weight` field added to every leaf (approximate current GitHub star counts — swapped for live star counts in a later sub-project) and one filename fixed: `Detectron2.png` → `detectron2.png` to match the actual file on disk (the original had a case mismatch that would 404 on a case-sensitive host).

Create `public/data/data-science/data.json`:

```json
{
    "id": "root",
    "name1": "Best Data Science Open Source Tools",
    "children": [
        {
            "id": "ML",
            "name1": "Classic Machine Learning",
            "children": [
                {
                    "id": "scikit-learn",
                    "name1": "SciKit Learn",
                    "image": "scikitlearn.png",
                    "link": "https://scikit-learn.org/stable/",
                    "desc": "Machine Learning in Python",
                    "gh": "https://github.com/scikit-learn/scikit-learn",
                    "weight": 58000
                },
                {
                    "id": "XGBoost",
                    "name1": "XGBoost",
                    "image": "xgboost.png",
                    "desc": "Scalable and Flexible Gradient Boosting",
                    "link": "https://xgboost.ai/",
                    "gh": "https://github.com/dmlc/xgboost",
                    "weight": 25000
                },
                {
                    "id": "Accord.NET",
                    "name1": "Accord.NET",
                    "image": "accord.png",
                    "link": "http://accord-framework.net/",
                    "desc": "Machine learning, computer vision, statistics for .NET",
                    "gh": "https://github.com/accord-net/framework",
                    "weight": 1200
                }
            ]
        },
        {
            "id": "Deep_Learning",
            "name1": "Deep Learning",
            "children": [
                {
                    "id": "TensorFlow",
                    "name1": "TensorFlow",
                    "image": "tensorflow.png",
                    "desc": "An end-to-end open source machine learning platform",
                    "link": "https://www.tensorflow.org/",
                    "gh": "https://github.com/tensorflow/tensorflow",
                    "weight": 180000
                },
                {
                    "id": "Sonnet",
                    "name1": "Sonnet",
                    "image": "sonnet.png",
                    "desc": "TensorFlow-based neural network library",
                    "link": "https://sonnet.dev/",
                    "gh": "https://github.com/deepmind/sonnet",
                    "weight": 9700
                },
                {
                    "id": "PyTorch",
                    "name1": "PyTorch",
                    "image": "pytorch.png",
                    "desc": "Tensors and Dynamic neural networks in Python with strong GPU acceleration",
                    "link": "https://pytorch.org/",
                    "gh": "https://github.com/pytorch/pytorch",
                    "weight": 75000
                },
                {
                    "id": "MXNet",
                    "name1": "MXNet",
                    "desc": "Lightweight, Portable, Flexible Distributed/Mobile Deep Learning",
                    "image": "mxnet.png",
                    "link": "https://mxnet.apache.org/",
                    "gh": "https://github.com/apache/incubator-mxnet",
                    "weight": 20500
                },
                {
                    "id": "dl4j",
                    "name1": "DL4j",
                    "desc": "Open-source, distributed, deep learning library for the JVM",
                    "image": "dl4j.png",
                    "link": "https://deeplearning4j.org/",
                    "gh": "https://github.com/eclipse/deeplearning4j",
                    "weight": 13000
                }
            ]
        },
        {
            "id": "RL",
            "name1": "Reinforment Learning",
            "children": [
                {
                    "id": "Gym",
                    "name1": "Gym",
                    "image": "gym.png",
                    "desc": "A toolkit for developing and comparing reinforcement learning algorithms",
                    "link": "https://gym.openai.com/",
                    "gh": "https://github.com/openai/gym",
                    "weight": 33000
                },
                {
                    "id": "Dopamine",
                    "name1": "Dopamine",
                    "image": "dopamine.png",
                    "desc": "a research framework for fast prototyping of reinforcement learning algorithms.",
                    "link": "https://github.com/google/dopamine",
                    "gh": "https://github.com/google/dopamine",
                    "weight": 10300
                },
                {
                    "id": "ReAgent",
                    "name1": "ReAgent",
                    "desc": "A platform for Reasoning systems (Reinforcement Learning, Contextual Bandits, etc.)",
                    "image": "reagent.png",
                    "link": "https://reagent.ai/",
                    "gh": "https://github.com/facebookresearch/ReAgent",
                    "weight": 3500
                },
                {
                    "id": "Tensorlayer",
                    "name1": "Tensorlayer",
                    "image": "tensorlayer.png",
                    "link": "http://tensorlayer.org",
                    "desc": "Deep Learning and Reinforcement Learning Library for Scientists",
                    "gh": "https://github.com/tensorlayer/tensorlayer",
                    "weight": 7300
                }
            ]
        },
        {
            "id": "NLP",
            "name1": "Natural Language Processing",
            "children": [
                {
                    "id": "BERT",
                    "name1": "BERT",
                    "image": "bert.png",
                    "desc": "A new method of pre-training language representations which obtains state-of-the-art results on a wide array of Natural Language Processing (NLP) tasks",
                    "link": "https://github.com/google-research/bert",
                    "gh": "https://github.com/google-research/bert",
                    "weight": 37000
                },
                {
                    "id": "transformers",
                    "name1": "Transformers",
                    "image": "transformers.png",
                    "desc": "State-of-the-art Natural Language Processing for TensorFlow 2.0 and PyTorch",
                    "link": "https://huggingface.co/transformers/",
                    "gh": "https://github.com/huggingface/transformers",
                    "weight": 130000
                },
                {
                    "id": "AllenNLP",
                    "name1": "AllenNLP",
                    "image": "allennlp.png",
                    "link": "https://github.com/allenai/allennlp",
                    "desc": "An open-source NLP research library, built on PyTorch.",
                    "gh": "https://github.com/allenai/allennlp",
                    "weight": 11700
                },
                {
                    "id": "flair",
                    "name1": "flair",
                    "image": "flair.png",
                    "link": "https://github.com/flairNLP/flair",
                    "desc": "A very simple framework for state-of-the-art Natural Language Processing (NLP)",
                    "gh": "https://github.com/flairNLP/flair",
                    "weight": 13700
                },
                {
                    "id": "spaCy",
                    "name1": "spaCy",
                    "image": "spacy.png",
                    "link": "https://spacy.io",
                    "desc": "Industrial-Strength Natural Language Processing",
                    "gh": "https://github.com/explosion/spaCy",
                    "weight": 29000
                },
                {
                    "id": "fastText",
                    "name1": "fastText",
                    "image": "fasttext.png",
                    "link": "https://fasttext.cc",
                    "desc": "Library for efficient text classification and representation learning",
                    "gh": "https://github.com/facebookresearch/fastText",
                    "weight": 25500
                }
            ]
        },
        {
            "id": "ASR",
            "name1": "Speech Recognition",
            "children": [
                {
                    "id": "Kaldi",
                    "name1": "Kaldi",
                    "image": "kaldi.png",
                    "link": "https://kaldi-asr.org",
                    "desc": "Kaldi is a toolkit for speech recognition",
                    "gh": "https://github.com/kaldi-asr/kaldi",
                    "weight": 14000
                },
                {
                    "id": "DeepSpeech",
                    "name1": "DeepSpeech",
                    "image": "deepspeech.png",
                    "link": "https://github.com/mozilla/DeepSpeech",
                    "desc": "A TensorFlow implementation of Baidu's DeepSpeech architecture",
                    "gh": "https://github.com/mozilla/DeepSpeech",
                    "weight": 24000
                },
                {
                    "id": "wav2letter",
                    "name1": "wav2letter",
                    "image": "wav2letter.png",
                    "link": "https://github.com/facebookresearch/wav2letter",
                    "desc": "Facebook AI Research's Automatic Speech Recognition Toolkit",
                    "gh": "https://github.com/facebookresearch/wav2letter",
                    "weight": 6300
                }
            ]
        },
        {
            "id": "CV",
            "name1": "Computer Vision",
            "children": [
                {
                    "id": "YOLO",
                    "name1": "YOLO",
                    "image": "yolo.png",
                    "link": "https://pjreddie.com/darknet/yolo/",
                    "desc": "Real-Time Object Detection",
                    "gh": "https://github.com/pjreddie/darknet",
                    "weight": 25500
                },
                {
                    "id": "OpenCV",
                    "name1": "OpenCV",
                    "image": "opencv.jpg",
                    "link": "https://opencv.org/",
                    "gh": "https://github.com/opencv/opencv",
                    "desc": "Open Source Computer Vision Library",
                    "weight": 74000
                },
                {
                    "id": "Detectron2",
                    "name1": "Detectron2",
                    "image": "detectron2.png",
                    "desc": "Detectron2 is FAIR's next-generation research platform for object detection.",
                    "link": "https://github.com/facebookresearch/detectron2",
                    "gh": "https://github.com/facebookresearch/detectron2",
                    "weight": 29000
                },
                {
                    "id": "openpose",
                    "name1": "OpenPose",
                    "image": "openpose.png",
                    "desc": "Real-time multi-person keypoint detection library for body, face, hands, and foot estimation",
                    "link": "https://github.com/CMU-Perceptual-Computing-Lab/openpose",
                    "gh": "https://github.com/CMU-Perceptual-Computing-Lab/openpose",
                    "weight": 30000
                },
                {
                    "id": "facenet",
                    "name1": "facenet",
                    "image": "facenet.jfif",
                    "desc": "Face recognition using Tensorflow",
                    "link": "https://github.com/davidsandberg/facenet",
                    "gh": "https://github.com/davidsandberg/facenet",
                    "weight": 13000
                }
            ]
        },
        {
            "id": "distributed",
            "name1": "Distributed Training",
            "children": [
                {
                    "id": "SparkMLlib",
                    "name1": "Spark MLlib",
                    "image": "sparkmlib.png",
                    "link": "https://spark.apache.org/mllib/",
                    "desc": "Apache Spark's scalable machine learning library.",
                    "gh": "https://github.com/apache/spark",
                    "weight": 38000
                },
                {
                    "id": "Mahout",
                    "name1": "Mahout",
                    "image": "mahout.png",
                    "link": "http://mahout.apache.org/",
                    "desc": "For Creating Scalable Performant Machine Learning Applications",
                    "gh": "https://github.com/apache/mahout",
                    "weight": 2100
                },
                {
                    "id": "Horovod",
                    "name1": "Horovod",
                    "image": "horovod.png",
                    "link": "https://eng.uber.com/horovod/",
                    "desc": "Uber's Open Source Distributed Deep Learning Framework for TensorFlow",
                    "gh": "https://github.com/horovod/horovod",
                    "weight": 14000
                },
                {
                    "id": "Dask",
                    "name1": "Dask",
                    "image": "dask.png",
                    "link": "https://dask.org/",
                    "desc": "Advanced parallelism for analytics, enabling performance at scale for the tools you love",
                    "gh": "https://github.com/dask/dask",
                    "weight": 12000
                },
                {
                    "id": "Ray",
                    "name1": "Ray",
                    "image": "ray.png",
                    "link": "https://ray.io/",
                    "desc": "A fast and simple framework for building and running distributed applications",
                    "gh": "https://github.com/ray-project/ray",
                    "weight": 30000
                }
            ]
        },
        {
            "id": "AutoML",
            "name1": "AutoML",
            "children": [
                {
                    "id": "TPOT",
                    "name1": "TPOT",
                    "image": "tpot.jpg",
                    "link": "https://epistasislab.github.io/tpot/",
                    "desc": "A Python Automated Machine Learning.",
                    "gh": "https://github.com/EpistasisLab/tpot",
                    "weight": 9500
                },
                {
                    "id": "AutoKeras",
                    "name1": "AutoKeras",
                    "image": "autokeras.png",
                    "desc": "Accessible AutoML for deep learning.",
                    "link": "https://autokeras.com/",
                    "gh": "https://github.com/keras-team/autokeras",
                    "weight": 9000
                },
                {
                    "id": "Featuretools",
                    "name1": "Featuretools",
                    "image": "featuretools.png",
                    "desc": "An open source python framework for automated feature engineering",
                    "link": "https://www.featuretools.com/",
                    "gh": "https://github.com/FeatureLabs/featuretools",
                    "weight": 7100
                },
                {
                    "id": "NNI",
                    "name1": "NNI",
                    "image": "nni.png",
                    "desc": "An open source AutoML toolkit for neural nets hyper-parameter tuning.",
                    "link": "https://github.com/microsoft/nni",
                    "gh": "https://github.com/microsoft/nni",
                    "weight": 13800
                },
                {
                    "id": "adanet",
                    "name1": "AdaNet",
                    "image": "adanet.jpeg",
                    "desc": "Fast and flexible AutoML with learning guarantees",
                    "link": "https://adanet.readthedocs.io",
                    "gh": "https://github.com/tensorflow/adanet",
                    "weight": 3400
                }
            ]
        },
        {
            "id": "IDEs",
            "name1": "IDEs",
            "children": [
                {
                    "id": "jupyter",
                    "name1": "Jupyter",
                    "image": "jupyter.png",
                    "desc": "Interactive computing across dozens of programming languages.",
                    "link": "https://jupyter.org/",
                    "gh": "https://github.com/jupyter/jupyter",
                    "weight": 3600
                },
                {
                    "id": "Spyder",
                    "name1": "Spyder",
                    "image": "spyder.png",
                    "link": "https://www.spyder-ide.org/",
                    "desc": "The Scientific Python Development Environment",
                    "gh": "https://github.com/spyder-ide/spyder",
                    "weight": 7800
                },
                {
                    "id": "Zeppelin",
                    "name1": "Zeppelin",
                    "image": "zeppelin.jpg",
                    "desc": "Web-based notebook that enables data-driven, interactive data analytics.",
                    "link": "https://zeppelin.apache.org/",
                    "gh": "https://github.com/apache/zeppelin",
                    "weight": 6300
                }
            ]
        },
        {
            "id": "Platforms",
            "name1": "Platforms",
            "children": [
                {
                    "id": "H2O",
                    "name1": "H2O",
                    "image": "h2o.png",
                    "desc": "Fast Scalable Machine Learning For Smarter Applications",
                    "link": "https://www.h2o.ai/",
                    "gh": "https://github.com/h2oai/h2o-3",
                    "weight": 6700
                },
                {
                    "id": "mlflow",
                    "name1": "MLflow",
                    "image": "mlflow.png",
                    "desc": "An open source platform for the machine learning lifecycle",
                    "link": "https://mlflow.org/",
                    "gh": "https://github.com/mlflow/mlflow",
                    "weight": 17000
                },
                {
                    "id": "Kubeflow",
                    "name1": "Kubeflow",
                    "image": "kubeflow.png",
                    "desc": "The Machine Learning Toolkit for Kubernetes",
                    "link": "https://www.kubeflow.org/",
                    "gh": "https://github.com/kubeflow/kubeflow",
                    "weight": 13800
                }
            ]
        },
        {
            "id": "Scoring",
            "name1": "Scoring",
            "children": [
                {
                    "id": "ONNX",
                    "name1": "ONNX",
                    "image": "onnx.png",
                    "desc": "The open ecosystem for interchangeable AI models.",
                    "link": "https://onnx.ai/",
                    "gh": "https://github.com/onnx/onnx",
                    "weight": 17000
                },
                {
                    "id": "Seldon",
                    "name1": "Seldon",
                    "image": "seldon.png",
                    "desc": "Open source machine learning deployment",
                    "link": "https://www.seldon.io/",
                    "gh": "https://github.com/SeldonIO/seldon-core",
                    "weight": 4300
                }
            ]
        }
    ]
}
```

- [ ] **Step 6: Remove the retired files**

```bash
git rm to_html.js data-science.html
git rm -r data-science
```

(The images and `data.json` were already moved out via `git mv` / the new file above, so this only removes what's left: the old `images` directory entry now empty of tracked files, if any leftover, plus the two retired top-level files.)

- [ ] **Step 7: Verify the migration**

Run:
```bash
node -e "const d = JSON.parse(require('fs').readFileSync('public/data/data-science/data.json')); console.log('categories:', d.children.length)"
ls public/data/data-science/images | wc -l
ls public/vendor/d3-hierarchy/index.js
```
Expected: `categories: 11`, an image count matching what was in the original `data-science/images/` (68), and the vendor file path printed with no error.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Scaffold toolchain, vendor d3-hierarchy, migrate data-science dataset with weights"
```

---

### Task 2: Pure layout logic (`layout.js`)

**Files:**
- Create: `public/shared/layout.js`
- Test: `test/layout.test.js`

**Interfaces:**
- Consumes: `d3-hierarchy`'s `hierarchy`, `treemap`, `treemapSquarify` (bare specifier, resolved via `node_modules` in Node and via the import map in the browser — see Task 3).
- Produces: `weightOf(nodeData)`, `buildHierarchy(rootData)`, `computeLayout(root, width, height)`, `projectRect(rect, focusRect, containerWidth, containerHeight)` — all consumed by `treemap.js` in Task 3.

- [ ] **Step 1: Write the failing tests**

Create `test/layout.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weightOf,
  buildHierarchy,
  computeLayout,
  projectRect,
} from "../public/shared/layout.js";

test("weightOf returns the leaf's weight when present", () => {
  assert.equal(weightOf({ id: "a", weight: 42 }), 42);
});

test("weightOf defaults a leaf with no weight field to 1", () => {
  assert.equal(weightOf({ id: "a" }), 1);
});

test("weightOf returns 0 for a category node (has children)", () => {
  assert.equal(weightOf({ id: "cat", children: [{ id: "a", weight: 5 }] }), 0);
});

test("buildHierarchy sums leaf weights up through categories", () => {
  const data = {
    id: "root",
    children: [
      { id: "cat", children: [{ id: "a", weight: 10 }, { id: "b", weight: 20 }] },
    ],
  };
  const root = buildHierarchy(data);
  assert.equal(root.value, 30);
  assert.equal(root.children[0].value, 30);
});

test("buildHierarchy defaults missing weight to 1 inside sums", () => {
  const data = { id: "root", children: [{ id: "a" }, { id: "b", weight: 5 }] };
  const root = buildHierarchy(data);
  assert.equal(root.value, 6);
});

test("computeLayout keeps every child's rect inside its parent's rect", () => {
  const data = {
    id: "root",
    children: [
      { id: "cat1", children: [{ id: "a", weight: 10 }, { id: "b", weight: 30 }] },
      { id: "cat2", children: [{ id: "c", weight: 20 }] },
    ],
  };
  const root = computeLayout(buildHierarchy(data), 900, 600);
  assert.equal(root.x0, 0);
  assert.equal(root.y0, 0);
  assert.equal(root.x1, 900);
  assert.equal(root.y1, 600);
  for (const category of root.children) {
    assert.ok(category.x0 >= root.x0 && category.x1 <= root.x1);
    assert.ok(category.y0 >= root.y0 && category.y1 <= root.y1);
    for (const leaf of category.children) {
      assert.ok(leaf.x0 >= category.x0 && leaf.x1 <= category.x1);
      assert.ok(leaf.y0 >= category.y0 && leaf.y1 <= category.y1);
    }
  }
});

test("computeLayout sizes rects roughly proportional to weight", () => {
  const data = { id: "root", children: [{ id: "a", weight: 10 }, { id: "b", weight: 90 }] };
  const root = computeLayout(buildHierarchy(data), 1000, 100);
  const [a, b] = root.children;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  const ratio = areaB / areaA;
  assert.ok(ratio > 7 && ratio < 11, `expected ~9x, got ${ratio}`);
});

test("projectRect maps the focus rect itself to fill the container", () => {
  const focusRect = { x0: 100, y0: 50, x1: 300, y1: 150 };
  const projected = projectRect(focusRect, focusRect, 800, 400);
  assert.deepEqual(projected, { left: 0, top: 0, width: 800, height: 400 });
});

test("projectRect scales a child rect relative to the focus rect", () => {
  const focusRect = { x0: 0, y0: 0, x1: 200, y1: 100 };
  const childRect = { x0: 100, y0: 0, x1: 200, y1: 100 };
  const projected = projectRect(childRect, focusRect, 400, 200);
  assert.deepEqual(projected, { left: 200, top: 0, width: 200, height: 200 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layout.test.js`
Expected: FAIL — `Cannot find module '../public/shared/layout.js'`.

- [ ] **Step 3: Implement `layout.js`**

Create `public/shared/layout.js`:

```js
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";

/**
 * Value accessor used by d3's hierarchy.sum(). Category nodes (nodes with
 * children) contribute nothing of their own — their size comes entirely
 * from their descendants. Leaf nodes contribute their own `weight`, or `1`
 * if `weight` is missing, so a partially-filled dataset never breaks layout.
 */
export function weightOf(nodeData) {
  if (nodeData.children && nodeData.children.length > 0) return 0;
  return typeof nodeData.weight === "number" ? nodeData.weight : 1;
}

/** Wraps the raw JSON tree in a d3 hierarchy with values summed via weightOf. */
export function buildHierarchy(rootData) {
  return hierarchy(rootData, (d) => d.children).sum(weightOf);
}

/**
 * Computes x0/y0/x1/y1 on every node of the hierarchy, in a coordinate
 * space sized [0, width] x [0, height]. Mutates and returns `root`.
 */
export function computeLayout(root, width, height) {
  treemap()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2)
    .paddingOuter(4)(root);
  return root;
}

/**
 * Projects a node's global rect (as set by computeLayout) into pixel
 * coordinates for display, given that `focusRect` currently fills the
 * container. This is what makes "zooming into a category" work: the
 * category's own rect maps to fill the container, and its children's rects
 * scale/translate the same way.
 */
export function projectRect(rect, focusRect, containerWidth, containerHeight) {
  const focusWidth = focusRect.x1 - focusRect.x0;
  const focusHeight = focusRect.y1 - focusRect.y0;
  const scaleX = containerWidth / focusWidth;
  const scaleY = containerHeight / focusHeight;
  return {
    left: (rect.x0 - focusRect.x0) * scaleX,
    top: (rect.y0 - focusRect.y0) * scaleY,
    width: (rect.x1 - rect.x0) * scaleX,
    height: (rect.y1 - rect.y0) * scaleY,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/layout.test.js`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add public/shared/layout.js test/layout.test.js
git commit -m "Add pure treemap layout logic with unit tests"
```

---

### Task 3: SPA shell and static (non-interactive) box rendering

**Files:**
- Create: `public/index.html`
- Create: `public/shared/main.js`
- Create: `public/shared/treemap.js`
- Create: `public/shared/treemap.css`

**Interfaces:**
- Consumes: `weightOf`/`buildHierarchy`/`computeLayout`/`projectRect` from `public/shared/layout.js` (Task 2).
- Produces: `mountTreemap(container, mapData, imageBaseUrl)` returning `{ root }` — Task 4 replaces this function's body to add interactivity, and later tasks call it with more arguments; the signature grows but the first three positional arguments stay stable.

- [ ] **Step 1: Create the SPA shell**

Create `public/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>techmap</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/shared/treemap.css" />
  <script type="importmap">
  {
    "imports": {
      "d3-hierarchy": "/vendor/d3-hierarchy/index.js"
    }
  }
  </script>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/shared/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implement the renderer**

Create `public/shared/treemap.js`:

```js
import { buildHierarchy, computeLayout, projectRect } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;

/**
 * Mounts a treemap for `mapData` (the parsed data.json tree) into
 * `container`. `imageBaseUrl` is the folder that leaf `image` filenames are
 * resolved against (e.g. "/data/data-science/images/").
 */
export function mountTreemap(container, mapData, imageBaseUrl) {
  const root = computeLayout(buildHierarchy(mapData), STAGE_WIDTH, STAGE_HEIGHT);

  container.innerHTML = "";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  stage.style.width = `${STAGE_WIDTH}px`;
  stage.style.height = `${STAGE_HEIGHT}px`;
  container.appendChild(stage);

  renderLevel(stage, root, imageBaseUrl);

  return { root };
}

/** Renders `focusNode`'s children as boxes positioned within `stage`. */
function renderLevel(stage, focusNode, imageBaseUrl) {
  stage.innerHTML = "";
  const focusRect = { x0: focusNode.x0, y0: focusNode.y0, x1: focusNode.x1, y1: focusNode.y1 };

  for (const child of focusNode.children ?? []) {
    const rect = projectRect(child, focusRect, STAGE_WIDTH, STAGE_HEIGHT);
    stage.appendChild(renderBox(child, rect, imageBaseUrl));
  }
}

function renderBox(node, rect, imageBaseUrl) {
  const box = document.createElement("div");
  box.className = node.children ? "treemap-box treemap-category" : "treemap-box treemap-leaf";
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;

  const label = document.createElement("span");
  label.className = "treemap-label";
  label.textContent = node.data.name1;
  box.appendChild(label);

  if (!node.children && node.data.image) {
    const img = document.createElement("img");
    img.className = "treemap-logo";
    img.src = imageBaseUrl + node.data.image;
    img.alt = node.data.name1;
    img.onerror = () => img.replaceWith(renderFallbackLogo(node.data.name1));
    box.insertBefore(img, label);
  }

  return box;
}

function renderFallbackLogo(name) {
  const fallback = document.createElement("span");
  fallback.className = "treemap-logo-fallback";
  fallback.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return fallback;
}
```

- [ ] **Step 3: Add styling**

Create `public/shared/treemap.css`:

```css
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #f4f4f6;
}

.treemap-stage {
  position: relative;
  margin: 24px auto;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

.treemap-box {
  position: absolute;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.treemap-category {
  background: #dce3f0;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 4px 6px;
  cursor: pointer;
}

.treemap-leaf {
  background: #ffffff;
  border: 1px solid #ccc;
  cursor: pointer;
  padding: 4px;
}

.treemap-label {
  font-size: 12px;
  color: #222;
}

.treemap-logo {
  max-width: 60%;
  max-height: 50%;
  object-fit: contain;
  margin-bottom: 4px;
}

.treemap-logo-fallback {
  font-size: 20px;
  font-weight: bold;
  color: #888;
  margin-bottom: 4px;
}
```

- [ ] **Step 4: Wire up a temporary entry point**

Create `public/shared/main.js` (hardcoded to the one existing map for now — Task 6 replaces this with real routing):

```js
import { mountTreemap } from "./treemap.js";

const app = document.getElementById("app");
const slug = "data-science";
const imageBaseUrl = `/data/${slug}/images/`;

fetch(`/data/${slug}/data.json`)
  .then((response) => response.json())
  .then((mapData) => mountTreemap(app, mapData, imageBaseUrl));
```

- [ ] **Step 5: Manually verify in the browser**

Run:
```bash
npx --yes serve public -l 5000
```
Open `http://localhost:5000/` and confirm:
- 11 category boxes are visible (Classic Machine Learning, Deep Learning, Reinforment Learning, Natural Language Processing, Speech Recognition, Computer Vision, Distributed Training, AutoML, IDEs, Platforms, Scoring).
- Box areas are visibly different sizes, roughly matching category weight totals (Deep Learning and NLP should be among the largest).
- No individual tools are visible yet — that's expected; only the root's direct children (categories) render until Task 4 adds zoom.

Stop the server (Ctrl+C) when done.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/shared/main.js public/shared/treemap.js public/shared/treemap.css
git commit -m "Render the root treemap level as static positioned boxes"
```

---

### Task 4: Zoomable drill-down with breadcrumb

**Files:**
- Modify: `public/shared/treemap.js`
- Modify: `public/shared/treemap.css`

**Interfaces:**
- Consumes: same `layout.js` exports as Task 3.
- Produces: `mountTreemap(container, mapData, imageBaseUrl, onLeafClick)` returning `{ zoomTo, root }`. `onLeafClick` is optional for now (Task 3's `main.js` doesn't pass it) — Task 5 supplies it to open the detail panel.

- [ ] **Step 1: Replace `treemap.js` with the zoom-aware version**

Replace the full contents of `public/shared/treemap.js`:

```js
import { buildHierarchy, computeLayout, projectRect } from "./layout.js";

const STAGE_WIDTH = 1000;
const STAGE_HEIGHT = 600;

/**
 * Mounts a treemap for `mapData` into `container`. `imageBaseUrl` resolves
 * leaf `image` filenames. `onLeafClick(leafData)`, if given, is called when
 * a leaf box is clicked (categories zoom instead of firing this callback).
 */
export function mountTreemap(container, mapData, imageBaseUrl, onLeafClick) {
  const root = computeLayout(buildHierarchy(mapData), STAGE_WIDTH, STAGE_HEIGHT);

  container.innerHTML = "";
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "treemap-breadcrumb";
  const stage = document.createElement("div");
  stage.className = "treemap-stage";
  stage.style.width = `${STAGE_WIDTH}px`;
  stage.style.height = `${STAGE_HEIGHT}px`;
  container.appendChild(breadcrumb);
  container.appendChild(stage);

  let focusNode = root;

  function zoomTo(node) {
    focusNode = node;
    renderBreadcrumb();
    renderLevel();
  }

  function renderBreadcrumb() {
    breadcrumb.innerHTML = "";
    const trail = focusNode.ancestors().reverse(); // root ... focusNode
    trail.forEach((node, index) => {
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.className = "treemap-crumb";
      crumb.textContent = node.data.name1;
      crumb.disabled = index === trail.length - 1;
      crumb.addEventListener("click", () => zoomTo(node));
      breadcrumb.appendChild(crumb);
      if (index < trail.length - 1) {
        const sep = document.createElement("span");
        sep.className = "treemap-crumb-sep";
        sep.textContent = " › ";
        breadcrumb.appendChild(sep);
      }
    });
  }

  function renderLevel() {
    stage.innerHTML = "";
    const focusRect = { x0: focusNode.x0, y0: focusNode.y0, x1: focusNode.x1, y1: focusNode.y1 };
    for (const child of focusNode.children ?? []) {
      const rect = projectRect(child, focusRect, STAGE_WIDTH, STAGE_HEIGHT);
      stage.appendChild(renderBox(child, rect));
    }
  }

  function renderBox(node, rect) {
    const box = document.createElement("div");
    box.className = node.children ? "treemap-box treemap-category" : "treemap-box treemap-leaf";
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const label = document.createElement("span");
    label.className = "treemap-label";
    label.textContent = node.data.name1;
    box.appendChild(label);

    if (!node.children && node.data.image) {
      const img = document.createElement("img");
      img.className = "treemap-logo";
      img.src = imageBaseUrl + node.data.image;
      img.alt = node.data.name1;
      img.onerror = () => img.replaceWith(renderFallbackLogo(node.data.name1));
      box.insertBefore(img, label);
    }

    if (node.children) {
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        zoomTo(node);
      });
    } else if (onLeafClick) {
      box.addEventListener("click", (event) => {
        event.stopPropagation();
        onLeafClick(node.data);
      });
    }

    return box;
  }

  renderBreadcrumb();
  renderLevel();

  return { zoomTo, root };
}

function renderFallbackLogo(name) {
  const fallback = document.createElement("span");
  fallback.className = "treemap-logo-fallback";
  fallback.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return fallback;
}
```

- [ ] **Step 2: Add breadcrumb styling**

Append to `public/shared/treemap.css`:

```css
.treemap-breadcrumb {
  max-width: 1000px;
  margin: 12px auto 0;
  font-size: 14px;
}

.treemap-crumb {
  background: none;
  border: none;
  color: #2b5fad;
  cursor: pointer;
  font: inherit;
  padding: 2px 4px;
}

.treemap-crumb:disabled {
  color: #333;
  cursor: default;
  font-weight: 600;
}

.treemap-crumb-sep {
  color: #888;
}
```

- [ ] **Step 3: Manually verify zoom and breadcrumb**

Run:
```bash
npx --yes serve public -l 5000
```
Open `http://localhost:5000/` and confirm:
- Clicking the "Deep Learning" category zooms in to show its 5 tools (TensorFlow, Sonnet, PyTorch, MXNet, DL4j) as boxes filling the stage.
- The breadcrumb now reads "Best Data Science Open Source Tools › Deep Learning", with the first part clickable and the second part shown as disabled/bold (current location).
- Clicking the first breadcrumb entry returns to the 11-category view.

Stop the server when done.

- [ ] **Step 4: Commit**

```bash
git add public/shared/treemap.js public/shared/treemap.css
git commit -m "Add zoomable drill-down with breadcrumb navigation"
```

---

### Task 5: Leaf detail panel

**Files:**
- Create: `public/shared/detail-panel.js`
- Modify: `public/shared/main.js`
- Modify: `public/shared/treemap.css`

**Interfaces:**
- Produces: `createDetailPanel(container, imageBaseUrl)` returning `{ open(leafData), close() }`.
- Consumes: `mountTreemap`'s `onLeafClick` parameter (Task 4) to trigger `open`.

- [ ] **Step 1: Implement the detail panel**

Create `public/shared/detail-panel.js`:

```js
/**
 * Creates a slide-in detail panel appended to `container`. `imageBaseUrl`
 * resolves the leaf's `image` filename. Returns { open(leafData), close() }.
 */
export function createDetailPanel(container, imageBaseUrl) {
  const panel = document.createElement("aside");
  panel.className = "detail-panel";
  container.appendChild(panel);

  function close() {
    panel.classList.remove("detail-panel-open");
    panel.innerHTML = "";
  }

  function open(leafData) {
    panel.innerHTML = "";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "detail-panel-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.addEventListener("click", close);
    panel.appendChild(closeButton);

    if (leafData.image) {
      const img = document.createElement("img");
      img.className = "detail-panel-logo";
      img.src = imageBaseUrl + leafData.image;
      img.alt = leafData.name1;
      img.onerror = () => img.remove();
      panel.appendChild(img);
    }

    const title = document.createElement("h2");
    title.textContent = leafData.name1;
    panel.appendChild(title);

    if (leafData.desc) {
      const desc = document.createElement("p");
      desc.textContent = leafData.desc;
      panel.appendChild(desc);
    }

    if (leafData.gh) {
      const ghFrame = document.createElement("iframe");
      ghFrame.className = "detail-panel-gh-button";
      ghFrame.src = githubStarButtonUrl(leafData.gh);
      ghFrame.width = "170";
      ghFrame.height = "30";
      ghFrame.frameBorder = "0";
      ghFrame.scrolling = "no";
      ghFrame.title = "GitHub Stars";
      panel.appendChild(ghFrame);
    }

    if (leafData.link) {
      const link = document.createElement("a");
      link.className = "detail-panel-link";
      link.href = leafData.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Visit site ↗";
      panel.appendChild(link);
    }

    panel.classList.add("detail-panel-open");
  }

  return { open, close };
}

/**
 * Builds a ghbtns.com star-count button URL from a github.com repo URL.
 * Using the iframe embed (rather than the buttons.github.io script, which
 * only scans the DOM once at page load) works correctly for buttons added
 * dynamically after the page has loaded.
 */
function githubStarButtonUrl(repoUrl) {
  const [, user, repo] = new URL(repoUrl).pathname.split("/");
  return `https://ghbtns.com/github-btn.html?user=${user}&repo=${repo}&type=star&count=true`;
}
```

- [ ] **Step 2: Wire it into `main.js`**

Replace the full contents of `public/shared/main.js`:

```js
import { mountTreemap } from "./treemap.js";
import { createDetailPanel } from "./detail-panel.js";

const app = document.getElementById("app");
const slug = "data-science";
const imageBaseUrl = `/data/${slug}/images/`;

const panel = createDetailPanel(document.body, imageBaseUrl);

fetch(`/data/${slug}/data.json`)
  .then((response) => response.json())
  .then((mapData) => mountTreemap(app, mapData, imageBaseUrl, (leafData) => panel.open(leafData)));
```

- [ ] **Step 3: Add panel styling**

Append to `public/shared/treemap.css`:

```css
.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100%;
  background: #fff;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.2);
  padding: 20px;
  box-sizing: border-box;
  transform: translateX(100%);
  transition: transform 0.2s ease-out;
  overflow-y: auto;
}

.detail-panel-open {
  transform: translateX(0);
}

.detail-panel-close {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 22px;
  background: none;
  border: none;
  cursor: pointer;
}

.detail-panel-logo {
  max-width: 100%;
  max-height: 120px;
  object-fit: contain;
  display: block;
  margin: 12px auto;
}

.detail-panel-link {
  display: inline-block;
  margin-top: 12px;
}
```

- [ ] **Step 4: Manually verify the detail panel**

Run:
```bash
npx --yes serve public -l 5000
```
Open `http://localhost:5000/`, zoom into "Deep Learning", then click the "TensorFlow" box. Confirm:
- A panel slides in from the right with the TensorFlow logo, its description, a GitHub star-count button showing a real star count, and a "Visit site ↗" link.
- Clicking × closes the panel.
- Clicking a different tool (e.g. PyTorch) while the panel is open updates its contents.

Stop the server when done.

- [ ] **Step 5: Commit**

```bash
git add public/shared/detail-panel.js public/shared/main.js public/shared/treemap.css
git commit -m "Add leaf detail panel with GitHub star button and outbound link"
```

---

### Task 6: Path-based routing, map index, and not-found handling

**Files:**
- Create: `public/shared/router.js`
- Test: `test/router.test.js`
- Modify: `public/shared/main.js`
- Modify: `public/shared/treemap.css`

**Interfaces:**
- Produces: `slugFromPath(pathname)` — pure function, used by `main.js`.

- [ ] **Step 1: Write the failing test**

Create `test/router.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugFromPath } from "../public/shared/router.js";

test("extracts a slug from a plain path", () => {
  assert.equal(slugFromPath("/data-science"), "data-science");
});

test("extracts a slug from a path with a trailing slash", () => {
  assert.equal(slugFromPath("/data-science/"), "data-science");
});

test("returns an empty string for the root path", () => {
  assert.equal(slugFromPath("/"), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/router.test.js`
Expected: FAIL — `Cannot find module '../public/shared/router.js'`.

- [ ] **Step 3: Implement `router.js`**

Create `public/shared/router.js`:

```js
/**
 * Extracts a map slug from a pathname like "/data-science" or
 * "/data-science/". An empty string means the root/index page.
 */
export function slugFromPath(pathname) {
  return pathname.replace(/^\/+|\/+$/g, "");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/router.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Replace `main.js` with real routing**

Replace the full contents of `public/shared/main.js`:

```js
import { mountTreemap } from "./treemap.js";
import { createDetailPanel } from "./detail-panel.js";
import { slugFromPath } from "./router.js";

const app = document.getElementById("app");
const slug = slugFromPath(window.location.pathname);

if (slug === "") {
  renderMapIndex();
} else {
  loadMap(slug);
}

function renderMapIndex() {
  app.innerHTML = `
    <div class="map-index">
      <h1>techmap</h1>
      <ul>
        <li><a href="/data-science">Best Data Science Open Source Tools</a></li>
      </ul>
    </div>
  `;
}

function renderNotFound(slug) {
  app.innerHTML = `
    <div class="map-not-found">
      <h1>Map not found</h1>
      <p>There's no map called "${slug}".</p>
      <p><a href="/">Back to all maps</a></p>
    </div>
  `;
}

function loadMap(slug) {
  const imageBaseUrl = `/data/${slug}/images/`;
  const panel = createDetailPanel(document.body, imageBaseUrl);

  fetch(`/data/${slug}/data.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`data.json fetch failed with ${response.status}`);
      return response.json();
    })
    .then((mapData) => {
      mountTreemap(app, mapData, imageBaseUrl, (leafData) => panel.open(leafData));
    })
    .catch((error) => {
      console.error(`Failed to load map "${slug}":`, error);
      renderNotFound(slug);
    });
}
```

- [ ] **Step 6: Add index/not-found styling**

Append to `public/shared/treemap.css`:

```css
.map-index, .map-not-found {
  max-width: 600px;
  margin: 60px auto;
  text-align: center;
}

.map-index ul {
  list-style: none;
  padding: 0;
}

.map-index li {
  margin: 12px 0;
}
```

- [ ] **Step 7: Manually verify routing**

Run:
```bash
npx --yes serve public -s -l 5000
```
(The `-s` flag enables single-page-app fallback, serving `index.html` for any path that isn't a real file — mimicking the Firebase rewrite from Task 7.)

Confirm in the browser:
- `http://localhost:5000/` shows the map index page with a "Best Data Science Open Source Tools" link.
- Clicking that link goes to `http://localhost:5000/data-science` and shows the treemap.
- `http://localhost:5000/nonexistent-map` shows the "Map not found" page with a working "Back to all maps" link.
- Reloading directly on `http://localhost:5000/data-science` (not navigating from the index) still works — confirms the route isn't dependent on client-side navigation state.

Stop the server when done.

- [ ] **Step 8: Commit**

```bash
git add public/shared/router.js public/shared/main.js public/shared/treemap.css test/router.test.js
git commit -m "Add path-based routing with map index and not-found states"
```

---

### Task 7: Firebase Hosting configuration and full verification pass

**Files:**
- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `README.md`

**Interfaces:**
- None — this task wires up deployment/local-emulation for everything built in Tasks 1–6.

- [ ] **Step 1: Create `firebase.json`**

```json
{
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

- [ ] **Step 2: Create `.firebaserc`**

Use Firebase's `demo-` project-ID convention, which the emulator treats as fully local — no real Firebase project needs to exist yet to verify Hosting behavior:

```json
{
  "projects": {
    "default": "demo-techmap"
  }
}
```

When you're ready to actually deploy, replace `demo-techmap` with your real Firebase project ID (create one at https://console.firebase.google.com if you haven't, or run `npx firebase-tools projects:list` if you already have).

- [ ] **Step 3: Add a short `README.md`**

```markdown
# techmap

Turns a `data.json` tree of categories and tools into an interactive,
zoomable treemap.

## Develop

    npm install
    npm run dev

Opens a static server at http://localhost:5000. Note: this doesn't apply
the clean-URL rewrite (see below) — use the Firebase emulator for that.

## Test

    npm test

## Preview with clean URLs (matches production routing)

    npx firebase-tools emulators:start --only hosting

## Deploy

Replace the placeholder project ID in `.firebaserc` with your real Firebase
project ID, then:

    npx firebase-tools deploy --only hosting

## Adding a new map

Add a folder under `public/data/<slug>/` with a `data.json` (see
`public/data/data-science/data.json` for the schema) and an `images/`
folder, then link to it from `public/shared/main.js`'s map index.
```

- [ ] **Step 4: Run the full verification pass against the Firebase emulator**

Run:
```bash
npx --yes firebase-tools emulators:start --only hosting
```

In another terminal, verify the routing/static-file split with curl:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/data-science
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/data-science/
curl -s -H "Accept: application/json" http://localhost:5000/data/data-science/data.json | head -c 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/nonexistent-path
```
Expected: the first, second, and fourth return `200` (all resolve to `index.html` via the catch-all rewrite), and the third prints real JSON starting with `{"id": "root", ...}` (confirming `/data/**` is served as a real file, not swallowed by the rewrite).

Then, in the browser at `http://localhost:5000/`, walk through the full manual checklist from the design spec:
- [ ] Map index at `/` lists the data-science map; the link works.
- [ ] `/data-science` renders the treemap with 11 categories, sized by weight.
- [ ] Clicking a category zooms in; the breadcrumb updates and its root entry navigates back out.
- [ ] Clicking a leaf opens the detail panel with logo, description, GitHub star count, and outbound link; × closes it.
- [ ] Temporarily rename one image file (e.g. `public/data/data-science/images/tensorflow.png` → `tensorflow.png.bak`), reload, zoom to that leaf, and confirm its box shows the initial-letter fallback instead of a broken image icon. Rename it back afterward.
- [ ] `/some-made-up-slug` shows the "Map not found" page with a working link back to `/`.

Stop the emulator (Ctrl+C) when done.

- [ ] **Step 5: Commit**

```bash
git add firebase.json .firebaserc README.md
git commit -m "Add Firebase Hosting configuration and deployment docs"
```
