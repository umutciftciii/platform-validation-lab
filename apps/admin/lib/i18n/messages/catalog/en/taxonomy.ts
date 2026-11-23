/**
 * ML-12a: English UI texts of the category and specification screens — the categories page and
 * components/catalog/category-manager.tsx, the specifications page and
 * components/catalog/spec-definitions.tsx, and the product's specification values
 * (components/catalog/spec-editor.tsx). Moved verbatim.
 */
export const taxonomy = {
  /** Words used by several of these screens. */
  shared: {
    allProducts: "All products",
    noAccessTitle: "No access to the product catalogue",
    noAccessBody: "Your roles do not include reading products on any site.",
    name: "Name",
    sortOrder: "Sort order",
    required: "Required",
    archived: "Archived",
    edit: "Edit",
    close: "Close",
    editName: "Edit {name}",
    delete: "Delete",
    deleteName: "Delete {name}",
    cancel: "Cancel",
    /** The product count of a category or a specification. */
    products: { one: "{count} product", other: "{count} products" },
  },
  /** app/(console)/products/categories/page.tsx */
  categoriesPage: {
    title: "Product categories",
    description:
      "Each site has its own category tree, up to three levels. The default category receives new listings that name no category.",
    translationTitle: "{language} category names on {site}",
    translationDescription:
      "Each name next to its {source} source. A product page in {language} needs its category name; the tree, slugs and order are the same in every language.",
    liveProducts: { one: "{count} live product", other: "{count} live products" },
    panelTitle: "Categories on {site}",
    count: { one: "{count} category", other: "{count} categories" },
    loadErrorTitle: "The categories could not be loaded",
    loadErrorBody: "You are not allowed to read this site's catalogue.",
  },
  /** components/catalog/category-manager.tsx */
  categories: {
    slug: "Slug",
    slugHint: "Unique on this site.",
    parent: "Parent",
    parentHint: "At most {max} levels.",
    parentNone: "None (top level)",
    description: "Description",
    confirmDelete: "Delete the category “{name}”? This cannot be undone.",
    emptyTitle: "No categories on {site} yet",
    emptyEditor: "Create the first category. It becomes the site's default for new listings.",
    emptyReader: "A site editor creates the categories of this site.",
    default: "Default",
    subCategories: { one: "{count} sub-category", other: "{count} sub-categories" },
    makeDefaultTitle: "Use for new listings without a category",
    makeDefault: "Make default",
    makeDefaultName: "Make {name} the default",
    deleteBlocked: "Only empty categories can be deleted",
    save: "Save category",
    newTitle: "New category on {site}",
    create: "Create category",
    new: "New category",
  },
  /** app/(console)/products/specifications/page.tsx */
  specificationsPage: {
    title: "Specifications",
    description:
      "Technical properties tracked for every product master: type, units, test methods and limits. Defined once for the whole platform.",
    translationTitle: "{language} specification names",
    translationDescription:
      "Shared by every product and site. Keys, units, test methods and limits are the same in every language.",
    translationEmpty: "No specifications are defined yet.",
    panelTitle: "Specification definitions",
    defined: "{n} defined",
    loadErrorTitle: "The specifications could not be loaded",
    loadErrorBody: "Try again in a moment.",
  },
  /** components/catalog/spec-definitions.tsx */
  definitions: {
    /** The data type of a definition (SpecDataType). */
    types: {
      NUMBER: "Number",
      RANGE: "Range (min–max)",
      TEXT: "Text",
      BOOLEAN: "Yes / no",
    },
    key: "Key",
    cannotChange: "Cannot change.",
    keyHint: "snake_case, unique.",
    dataType: "Data type",
    units: "Units",
    unitsHint: "Comma separated; first is the default.",
    minimum: "Minimum",
    maximum: "Maximum",
    decimals: "Decimals",
    decimalsHint: "0–6, empty: any.",
    maxLength: "Max length",
    testMethods: "Test methods",
    testMethodsHint: "Recommended, comma separated (e.g. ASTM D445, ISO 3104).",
    requiredForPublication: "Required for publication",
    archivedHidden: "Archived (hidden for new values)",
    created: "Specification “{name}” created.",
    saved: "Specification “{name}” saved.",
    deleted: "Specification “{name}” deleted.",
    confirmDelete: "Delete the specification “{name}”? This cannot be undone.",
    emptyTitle: "No specifications defined yet",
    emptyEditor:
      "Define the technical properties you track for products, e.g. kinematic viscosity at 100 °C.",
    emptyReader: "The platform product team defines the specifications.",
    deleteBlocked: "In use: archive it instead",
    save: "Save specification",
    newTitle: "New specification",
    create: "Create specification",
  },
  /** components/catalog/spec-editor.tsx (a product's specification values) */
  specEditor: {
    /** The data type of a definition, short (SpecDataType). */
    types: {
      NUMBER: "Number",
      RANGE: "Range",
      TEXT: "Text",
      BOOLEAN: "Yes / no",
    },
    requiredForPublication: "Required for publication.",
    enterValue: "Enter a value or remove it.",
    enterNumber: "Enter a number.",
    refused: "Refused by the server ({rule}).",
    saved: "Technical specifications saved.",
    emptyTitle: "No specifications defined yet",
    emptyAction: "Define specifications",
    emptyBody:
      "Specifications (viscosity, flash point, …) are defined once for the whole platform, then filled in per product.",
    addTypical: "Add typical value",
    /** Screen-reader rest of "Add typical value" / "Add value" (TR word order: see tr). */
    forName: " for {name}",
    archivedReadOnly: "This product is archived. Restore it to edit its specifications.",
    masterReadOnly: "Specifications are part of the product master (product_master:edit).",
    manageDefinitions: "Manage specification definitions",
    saving: "Saving…",
    save: "Save specifications",
    /** The accessible name of a typical value's inputs. */
    typicalLabel: "{name} typical value",
    typicalHeading: "Typical value",
    typicalNote: "(for information, not a limit)",
    noValue: "No value",
    addValue: "Add value",
    valuePlaceholder: "Value",
    minBoundLabel: "{label} minimum: closed or open",
    minLabel: "{label} minimum",
    minPlaceholder: "Min",
    maxBoundLabel: "{label} maximum: closed or open",
    maxLabel: "{label} maximum",
    maxPlaceholder: "Max",
    choose: "Choose…",
    yes: "Yes",
    no: "No",
    unitLabel: "{label} unit",
    testMethodLabel: "{label} test method",
    testMethodPlaceholder: "Test method",
    removeTypical: "Remove the typical value of {name}",
    removeValue: "Remove the value of {name}",
  },
  /** ValidationSummary in components/catalog/spec-editor.tsx */
  summary: {
    unsaved: "Checked as typed: includes changes that are not saved yet.",
    complete: "Technical data complete: nothing blocks publication.",
    blocking: {
      one: "{count} blocking issue — publication would be refused",
      other: "{count} blocking issues — publication would be refused",
    },
    warnings: { one: "{count} warning", other: "{count} warnings" },
  },
} as const;
