import {getLoginOrSignupUrl, urlState} from 'app/client/models/gristUrlState';
import {HomeModel} from 'app/client/models/HomeModel';
import {productPill} from 'app/client/ui/AppHeader';
import * as css from 'app/client/ui/DocMenuCss';
import {createDocAndOpen, importDocAndOpen} from 'app/client/ui/HomeLeftPane';
import {manageTeamUsersApp} from 'app/client/ui/OpenUserManager';
import {bigBasicButton, cssButton} from 'app/client/ui2018/buttons';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {commonUrls, shouldHideUiElement} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {Computed, dom, DomContents, styled} from 'grainjs';


export function buildHomeIntro(homeModel: HomeModel): DomContents {
  const isViewer = homeModel.app.currentOrg?.access === roles.VIEWER;
  const user = homeModel.app.currentValidUser;
  const isAnonym = !user;
  const isPersonal = !homeModel.app.isTeamSite;
  if (isAnonym) {
    return makeAnonIntro(homeModel);
  } else if (isPersonal) {
    return makePersonalIntro(homeModel, user);
  } else { // isTeamSite
    if (isViewer) {
      return makeViewerTeamSiteIntro(homeModel);
    } else {
      return makeTeamSiteIntro(homeModel);
    }
  }
}

function makeViewerTeamSiteIntro(homeModel: HomeModel) {
  const personalOrg = Computed.create(null, use => use(homeModel.app.topAppModel.orgs).find(o => o.owner));
  const docLink = (dom.maybe(personalOrg, org => {
    return cssLink(
      urlState().setLinkUrl({org: org.domain ?? undefined}),
      'personal site',
      testId('welcome-personal-url'));
  }));
  return [
    css.docListHeader(
      dom.autoDispose(personalOrg),
      `Welcome to ${homeModel.app.currentOrgName}`,
      productPill(homeModel.app.currentOrg, {large: true}),
      testId('welcome-title')
    ),
    cssIntroLine(
      testId('welcome-info'),
      "You have read-only access to this site. Currently there are no documents.", dom('br'),
      "Any documents created in this site will appear here."),
    cssIntroLine(
      'Interested in using Grist outside of your team? Visit your free ', docLink, '.',
      testId('welcome-text')
    )
  ];
}

function makeTeamSiteIntro(homeModel: HomeModel) {
  const sproutsProgram = cssLink({href: commonUrls.sproutsProgram, target: '_blank'}, 'Sprouts Program');
  return [
    css.docListHeader(
      `Welcome to ${homeModel.app.currentOrgName}`,
      productPill(homeModel.app.currentOrg, {large: true}),
      testId('welcome-title')
    ),
    cssIntroLine('Get started by inviting your team and creating your first Grist document.'),
    (shouldHideUiElement('helpCenter') ? null :
      cssIntroLine(
        'Learn more in our ', helpCenterLink(), ', or find an expert via our ', sproutsProgram, '.',
        testId('welcome-text')
      )
    ),
    makeCreateButtons(homeModel)
  ];
}

function makePersonalIntro(homeModel: HomeModel, user: FullUser) {
  return [
    css.docListHeader(`Welcome to Grist, ${user.name}!`, testId('welcome-title')),
    cssIntroLine('Get started by creating your first Grist document.'),
    (shouldHideUiElement('helpCenter') ? null :
      cssIntroLine('Visit our ', helpCenterLink(), ' to learn more.',
        testId('welcome-text'))
    ),
    makeCreateButtons(homeModel),
  ];
}

function makeAnonIntro(homeModel: HomeModel) {
  const signUp = cssLink({href: getLoginOrSignupUrl()}, 'Sign up');
  return [
    css.docListHeader(`Welcome to Grist!`, testId('welcome-title')),
    cssIntroLine('Get started by exploring templates, or creating your first Grist document.'),
    cssIntroLine(signUp, ' to save your work.',
      (shouldHideUiElement('helpCenter') ? null : [' Visit our ', helpCenterLink(), ' to learn more.']),
      testId('welcome-text')),
    makeCreateButtons(homeModel),
  ];
}

function helpCenterLink() {
  return cssLink({href: commonUrls.help, target: '_blank'}, cssInlineIcon('Help'), 'Help Center');
}


function makeCreateButtons(homeModel: HomeModel) {
  const canManageTeam = homeModel.app.isTeamSite &&
    roles.canEditAccess(homeModel.app.currentOrg?.access || null);
  return cssBtnGroup(
    (canManageTeam ?
      cssBtn(cssBtnIcon('Help'), 'Invite Team Members', testId('intro-invite'),
        cssButton.cls('-primary'),
        dom.on('click', () => manageTeamUsersApp(homeModel.app)),
      ) :
      cssBtn(cssBtnIcon('FieldTable'), 'Browse Templates', testId('intro-templates'),
        cssButton.cls('-primary'),
        dom.hide(shouldHideUiElement("templates")),
        urlState().setLinkUrl({homePage: 'templates'}),
      )
    ),
    cssBtn(cssBtnIcon('Import'), 'Import Document', testId('intro-import-doc'),
      dom.on('click', () => importDocAndOpen(homeModel)),
    ),
    cssBtn(cssBtnIcon('Page'), 'Create Empty Document', testId('intro-create-doc'),
      dom.on('click', () => createDocAndOpen(homeModel)),
    ),
  );
}

const cssParagraph = styled(css.docBlock, `
  color: ${theme.text};
  line-height: 1.6;
`);

const cssIntroLine = styled(cssParagraph, `
  font-size: ${vars.introFontSize};
  margin-bottom: 8px;
`);

const cssBtnGroup = styled('div', `
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
`);

const cssBtn = styled(bigBasicButton, `
  display: flex;
  align-items: center;
  margin-right: 16px;
  margin-top: 16px;
  text-align: left;
`);

const cssBtnIcon = styled(icon, `
  margin-right: 8px;
`);

const cssInlineIcon = styled(icon, `
  margin: -2px 4px 2px 4px;
`);
