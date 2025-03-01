import {CursorPos} from 'app/client/components/Cursor';
import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {buildHighlightedCode, cssCodeBlock} from 'app/client/ui/CodeHighlight';
import {cssBlockedCursor, cssLabel, cssRow} from 'app/client/ui/RightPanelStyles';
import {buildFormulaTriggers} from 'app/client/ui/TriggerFormulas';
import {textButton} from 'app/client/ui2018/buttons';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {cssIconButton, icon} from 'app/client/ui2018/icons';
import {IconName} from 'app/client/ui2018/IconList';
import {selectMenu, selectOption, selectTitle} from 'app/client/ui2018/menus';
import {createFormulaErrorObs, cssError} from 'app/client/widgets/FormulaEditor';
import {sanitizeIdent} from 'app/common/gutil';
import {bundleChanges, Computed, dom, DomContents, DomElementArg, fromKo, MultiHolder,
        Observable, styled} from 'grainjs';
import * as ko from 'knockout';

export function buildNameConfig(owner: MultiHolder, origColumn: ColumnRec, cursor: ko.Computed<CursorPos>) {
  const untieColId = origColumn.untieColIdFromLabel;

  const editedLabel = Observable.create(owner, '');
  const editableColId = Computed.create(owner, editedLabel, (use, edited) =>
    '$' + (edited ? sanitizeIdent(edited) : use(origColumn.colId)));
  const saveColId = (val: string) => origColumn.colId.saveOnly(val.startsWith('$') ? val.slice(1) : val);

  const isSummaryTable = Computed.create(owner, use => Boolean(use(use(origColumn.table).summarySourceTable)));
  // We will listen to cursor position and force a blur event on
  // the text input, which will trigger save before the column observable
  // will change its value.
  // Otherwise, blur will be invoked after column change and save handler will
  // update a different column.
  let editor: HTMLInputElement | undefined;
  owner.autoDispose(
   cursor.subscribe(() => {
     editor?.blur();
   })
  );

  return [
    cssLabel('COLUMN LABEL AND ID'),
    cssRow(
      dom.cls(cssBlockedCursor.className, origColumn.disableModify),
      cssColLabelBlock(
        editor = cssInput(fromKo(origColumn.label),
          async val => { await origColumn.label.saveOnly(val); editedLabel.set(''); },
          dom.on('input', (ev, elem) => { if (!untieColId.peek()) { editedLabel.set(elem.value); } }),
          dom.boolAttr('disabled', origColumn.disableModify),
          testId('field-label'),
        ),
        cssInput(editableColId,
          saveColId,
          dom.boolAttr('disabled', use => use(origColumn.disableModify) || !use(origColumn.untieColIdFromLabel)),
          cssCodeBlock.cls(''),
          {style: 'margin-top: 8px'},
          testId('field-col-id'),
        ),
      ),
      cssColTieBlock(
        cssColTieConnectors(),
        cssToggleButton(icon('FieldReference'),
          cssToggleButton.cls('-selected', (use) => !use(untieColId)),
          dom.on('click', () => !origColumn.disableModify.peek() && untieColId.saveOnly(!untieColId.peek())),
          cssToggleButton.cls("-disabled", origColumn.disableModify),
          testId('field-derive-id')
        ),
      )
    ),
    dom.maybe(isSummaryTable,
      () => cssRow('Column options are limited in summary tables.'))
  ];
}

type SaveHandler = (column: ColumnRec, formula: string) => Promise<void>;
type BuildEditor = (
  cellElem: Element,
  editValue?: string,
  onSave?: SaveHandler,
  onCancel?: () => void) => void;

type BEHAVIOR = "empty"|"formula"|"data";

export function buildFormulaConfig(
  owner: MultiHolder, origColumn: ColumnRec, gristDoc: GristDoc, buildEditor: BuildEditor
) {

  // Intermediate state - user wants to specify formula, but haven't done yet
  const maybeFormula = Observable.create(owner, false);

  // Intermediate state - user wants to specify formula, but haven't done yet
  const maybeTrigger = Observable.create(owner, false);

  // If this column belongs to a summary table.
  const isSummaryTable = Computed.create(owner, use => Boolean(use(use(origColumn.table).summarySourceTable)));

  // Column behaviour. There are 3 types of behaviors:
  // - empty: isFormula and formula == ''
  // - formula: isFormula and formula != ''
  // - data: not isFormula nd formula == ''
  const behavior = Computed.create<BEHAVIOR|null>(owner, (use) => {
    // When no id column is invalid, show nothing.
    if (!use(origColumn.id)) { return null; }
    // Column is a formula column, when it is a formula column with valid formula or will be a formula.
    if (use(origColumn.isRealFormula) || use(maybeFormula)) { return "formula"; }
    // If column is not empty, or empty but wants to be a trigger
    if (use(maybeTrigger) || !use(origColumn.isEmpty)) { return "data"; }
    return "empty";
  });

  // Reference to current editor, we will open it when user wants to specify a formula or trigger.
  // And close it dispose it when user opens up behavior menu.
  let formulaField: HTMLElement|null = null;

  // Helper function to clear temporary state (will be called when column changes or formula editor closes)
  const clearState = () => bundleChanges(() => {
    maybeFormula.set(false);
    maybeTrigger.set(false);
    formulaField = null;
  });

  // Clear state when column has changed
  owner.autoDispose(origColumn.id.subscribe(clearState));
  owner.autoDispose(origColumn.formula.subscribe(clearState));
  owner.autoDispose(origColumn.isFormula.subscribe(clearState));

  // Menu helper that will show normal menu with some default options
  const menu = (label: DomContents, options: DomElementArg[]) =>
    cssRow(
      selectMenu(
        label,
        () => options,
        testId("field-behaviour"),
        // HACK: Menu helper will add tabindex to this element, which will make
        // this element focusable and will steal focus from clipboard. This in turn,
        // will not dispose the formula editor when menu is clicked.
        (el) => el.removeAttribute("tabindex"),
        dom.cls(cssBlockedCursor.className, origColumn.disableModify),
        dom.cls("disabled", origColumn.disableModify)),
    );

  // Behaviour label
  const behaviorName = Computed.create(owner, behavior, (use, type) => {
    if (type === 'formula') { return "Formula Column"; }
    if (type === 'data') { return "Data Column"; }
    return "Empty Column";
  });
  const behaviorIcon = Computed.create<IconName>(owner, (use) => {
    return use(behaviorName) === "Data Column" ? "Database" : "Script";
  });
  const behaviourLabel = () => selectTitle(behaviorName, behaviorIcon);

  // Actions on select menu:

  // Converts data column to formula column.
  const convertDataColumnToFormulaOption = () => selectOption(
    () => (maybeFormula.set(true), formulaField?.focus()),
    'Clear and make into formula', 'Script');

  // Converts to empty column and opens up the editor. (label is the same, but this is used when we have no formula)
  const convertTriggerToFormulaOption = () => selectOption(
    () => gristDoc.convertIsFormula([origColumn.id.peek()], {toFormula: true, noRecalc: true}),
    'Clear and make into formula', 'Script');

  // Convert column to data.
  // This method is also available through a text button.
  const convertToData = () => gristDoc.convertIsFormula([origColumn.id.peek()], {toFormula: false, noRecalc: true});
  const convertToDataOption = () => selectOption(
    convertToData,
    'Convert column to data', 'Database',
    dom.cls('disabled', isSummaryTable)
    );

  // Clears the column
  const clearAndResetOption = () => selectOption(
    () => gristDoc.clearColumns([origColumn.id.peek()]),
    'Clear and reset', 'CrossSmall');

  // Actions on text buttons:

  // Tries to convert data column to a trigger column.
  const convertDataColumnToTriggerColumn = () => {
    maybeTrigger.set(true);
    // Open the formula editor.
    formulaField?.focus();
  };

  // Converts formula column to trigger formula column.
  const convertFormulaToTrigger = () =>
    gristDoc.convertIsFormula([origColumn.id.peek()], {toFormula: false, noRecalc: false});

  const setFormula = () => (maybeFormula.set(true), formulaField?.focus());
  const setTrigger = () => (maybeTrigger.set(true), formulaField?.focus());

  // Actions on save formula. Those actions are using column that comes from FormulaEditor.
  // Formula editor scope is broader then RightPanel, it can be disposed after RightPanel is closed,
  // and in some cases, when window is in background, it won't be disposed at all when panel is closed.

  // Converts column to formula column.
  const onSaveConvertToFormula = async (column: ColumnRec, formula: string) => {
    // For non formula column, we will not convert it to formula column when expression is empty,
    // as it means we were trying to convert data column to formula column, but changed our mind.
    const notBlank = Boolean(formula);
    // But when the column is a formula column, empty formula expression is acceptable (it will
    // convert column to empty column).
    const trueFormula = column.formula.peek();
    if (notBlank || trueFormula) { await gristDoc.convertToFormula(column.id.peek(), formula); }
    // Clear state only when owner was not disposed
    if (!owner.isDisposed()) {
      clearState();
    }
  };

  // Updates formula or convert column to trigger formula column if necessary.
  const onSaveConvertToTrigger = async (column: ColumnRec, formula: string) => {
    // If formula expression is not empty, and column was plain data column (without a formula)
    if (formula && !column.hasTriggerFormula.peek()) {
      // then convert column to a trigger formula column
      await gristDoc.convertToTrigger(column.id.peek(), formula);
    } else if (column.hasTriggerFormula.peek()) {
      // else, if it was already a trigger formula column, just update formula.
      await gristDoc.updateFormula(column.id.peek(), formula);
    }
    // Clear state only when owner was not disposed
    if (!owner.isDisposed()) {
      clearState();
    }
  };

  const errorMessage = createFormulaErrorObs(owner, gristDoc, origColumn);
  // Helper that will create different flavors for formula builder.
  const formulaBuilder = (onSave: SaveHandler) => [
    cssRow(formulaField = buildFormula(
      origColumn,
      buildEditor,
      "Enter formula",
      onSave,
      clearState)),
    dom.maybe(errorMessage, errMsg => cssRow(cssError(errMsg), testId('field-error-count'))),
  ];

  return dom.maybe(behavior, (type: BEHAVIOR) => [
      cssLabel('COLUMN BEHAVIOR'),
      ...(type === "empty" ? [
        menu(behaviourLabel(), [
          convertToDataOption(),
        ]),
        cssEmptySeparator(),
        cssRow(textButton(
          "Set formula",
          dom.on("click", setFormula),
          dom.prop("disabled", origColumn.disableModify),
          testId("field-set-formula")
        )),
        cssRow(textButton(
          "Set trigger formula",
          dom.on("click", setTrigger),
          dom.prop("disabled", use => use(isSummaryTable) || use(origColumn.disableModify)),
          testId("field-set-trigger")
        )),
        cssRow(textButton(
          "Make into data column",
          dom.on("click", convertToData),
          dom.prop("disabled", use => use(isSummaryTable) || use(origColumn.disableModify)),
          testId("field-set-data")
        ))
      ] : type === "formula" ? [
        menu(behaviourLabel(), [
          convertToDataOption(),
          clearAndResetOption(),
        ]),
        formulaBuilder(onSaveConvertToFormula),
        cssEmptySeparator(),
        cssRow(textButton(
          "Convert to trigger formula",
          dom.on("click", convertFormulaToTrigger),
          dom.hide(maybeFormula),
          dom.prop("disabled", use => use(isSummaryTable) || use(origColumn.disableModify)),
          testId("field-set-trigger")
        ))
      ] : /* type == 'data' */ [
        menu(behaviourLabel(),
          [
            dom.domComputed(origColumn.hasTriggerFormula, (hasTrigger) => hasTrigger ?
              // If we have trigger, we will convert it directly to a formula column
              convertTriggerToFormulaOption() :
              // else we will convert to empty column and open up the editor
              convertDataColumnToFormulaOption()
            ),
            clearAndResetOption(),
          ]
        ),
        // If data column is or wants to be a trigger formula:
        dom.maybe((use) => use(maybeTrigger) || use(origColumn.hasTriggerFormula), () => [
          cssLabel('TRIGGER FORMULA'),
          formulaBuilder(onSaveConvertToTrigger),
          dom.create(buildFormulaTriggers, origColumn, maybeTrigger)
        ]),
        // Else offer a way to convert to trigger formula.
        dom.maybe((use) => !(use(maybeTrigger) || use(origColumn.hasTriggerFormula)), () => [
          cssEmptySeparator(),
          cssRow(textButton(
            "Set trigger formula",
            dom.on("click", convertDataColumnToTriggerColumn),
            dom.prop("disabled", origColumn.disableModify),
            testId("field-set-trigger")
          ))
        ])
      ])
  ]);
}

function buildFormula(
    column: ColumnRec,
    buildEditor: BuildEditor,
    placeholder: string,
    onSave?: SaveHandler,
    onCancel?: () => void) {
  return cssFieldFormula(column.formula, {placeholder, maxLines: 2},
    dom.cls('formula_field_sidepane'),
    cssFieldFormula.cls('-disabled', column.disableModify),
    cssFieldFormula.cls('-disabled-icon', use => !use(column.formula)),
    dom.cls('disabled'),
    {tabIndex: '-1'},
    // Focus event use used by a user to edit an existing formula.
    // It can also be triggered manually to open up the editor.
    dom.on('focus', (_, elem) => buildEditor(elem, undefined, onSave, onCancel)),
  );
}

export const cssFieldFormula = styled(buildHighlightedCode, `
  flex: auto;
  cursor: pointer;
  margin-top: 4px;
  padding-left: 24px;
  --icon-color: ${theme.accentIcon};

  &-disabled-icon.formula_field_sidepane::before {
    --icon-color: ${theme.lightText};
  }
  &-disabled {
    pointer-events: none;
  }
`);

const cssToggleButton = styled(cssIconButton, `
  margin-left: 8px;
  background-color: ${theme.rightPanelToggleButtonDisabledBg};
  box-shadow: inset 0 0 0 1px ${theme.inputBorder};

  &-selected, &-selected:hover {
    box-shadow: none;
    background-color: ${theme.rightPanelToggleButtonEnabledBg};
    --icon-color: ${theme.rightPanelToggleButtonEnabledFg};
  }
  &-selected:hover {
    --icon-color: ${theme.rightPanelToggleButtonEnabledHoverFg};
  }
  &-disabled, &-disabled:hover {
    --icon-color: ${theme.rightPanelToggleButtonDisabledFg};
    background-color: ${theme.rightPanelToggleButtonDisabledBg};
  }
`);

const cssColLabelBlock = styled('div', `
  display: flex;
  flex-direction: column;
  flex: auto;
  min-width: 80px;
`);

const cssColTieBlock = styled('div', `
  position: relative;
`);

const cssColTieConnectors = styled('div', `
  position: absolute;
  border: 2px solid ${theme.inputBorder};
  top: -9px;
  bottom: -9px;
  right: 11px;
  left: 0px;
  border-left: none;
  z-index: -1;
`);

const cssEmptySeparator = styled('div', `
  margin-top: 16px;
`);

const cssInput = styled(textInput, `
  color: ${theme.inputFg};
  background-color: ${theme.mainPanelBg};
  border: 1px solid ${theme.inputBorder};

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }

  &:disabled {
    background-color: ${theme.inputDisabledBg};
    color: ${theme.inputDisabledFg};
  }
`);
