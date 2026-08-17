#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString * const ControlDeckURLString = @"http://127.0.0.1:50703/";

@interface ControlDeckAppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic) BOOL showingOfflinePage;
@end

@implementation ControlDeckAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self installMainMenu];
    [self createWindow];
    [self ensureLocalServices];
    [self loadControlDeck];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    if (!visible) [self.window makeKeyAndOrderFront:nil];
    return YES;
}

- (void)createWindow {
    NSRect frame = NSMakeRect(0, 0, 1380, 880);
    NSWindowStyleMask style = NSWindowStyleMaskTitled |
                              NSWindowStyleMaskClosable |
                              NSWindowStyleMaskMiniaturizable |
                              NSWindowStyleMaskResizable;
    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    self.window.title = @"Bitwig Control Deck";
    self.window.titleVisibility = NSWindowTitleVisible;
    self.window.titlebarAppearsTransparent = NO;
    self.window.movableByWindowBackground = YES;
    self.window.backgroundColor = [NSColor colorWithRed:0.035 green:0.047 blue:0.051 alpha:1.0];
    self.window.minSize = NSMakeSize(860, 620);
    self.window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
    [self.window center];

    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
    configuration.defaultWebpagePreferences.allowsContentJavaScript = YES;
    self.webView = [[WKWebView alloc] initWithFrame:frame configuration:configuration];
    self.webView.navigationDelegate = self;
    self.webView.allowsMagnification = YES;
    self.webView.allowsBackForwardNavigationGestures = NO;
    self.webView.underPageBackgroundColor = self.window.backgroundColor;
    self.window.contentView = self.webView;
}

- (void)installMainMenu {
    NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@"Main Menu"];

    NSMenuItem *applicationItem = [[NSMenuItem alloc] init];
    NSMenu *applicationMenu = [[NSMenu alloc] initWithTitle:@"Bitwig Control Deck"];
    [applicationMenu addItemWithTitle:@"About Bitwig Control Deck" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [applicationMenu addItem:[NSMenuItem separatorItem]];
    [applicationMenu addItemWithTitle:@"Hide Bitwig Control Deck" action:@selector(hide:) keyEquivalent:@"h"];
    [applicationMenu addItemWithTitle:@"Hide Others" action:@selector(hideOtherApplications:) keyEquivalent:@"h"].keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagOption;
    [applicationMenu addItemWithTitle:@"Show All" action:@selector(unhideAllApplications:) keyEquivalent:@""];
    [applicationMenu addItem:[NSMenuItem separatorItem]];
    [applicationMenu addItemWithTitle:@"Quit Bitwig Control Deck" action:@selector(terminate:) keyEquivalent:@"q"];
    applicationItem.submenu = applicationMenu;
    [mainMenu addItem:applicationItem];

    NSMenuItem *editItem = [[NSMenuItem alloc] init];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;
    [mainMenu addItem:editItem];

    NSMenuItem *viewItem = [[NSMenuItem alloc] init];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];
    NSMenuItem *reload = [viewMenu addItemWithTitle:@"Reload Control Deck" action:@selector(reloadControlDeck:) keyEquivalent:@"r"];
    reload.target = self;
    [viewMenu addItem:[NSMenuItem separatorItem]];
    [viewMenu addItemWithTitle:@"Enter Full Screen" action:@selector(toggleFullScreen:) keyEquivalent:@"f"].keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagControl;
    viewItem.submenu = viewMenu;
    [mainMenu addItem:viewItem];

    NSApp.mainMenu = mainMenu;
}

- (void)ensureLocalServices {
    NSString *domain = [NSString stringWithFormat:@"gui/%u", getuid()];
    for (NSString *label in @[@"com.controldeck.api", @"com.controldeck.dashboard"]) {
        NSTask *task = [[NSTask alloc] init];
        task.executableURL = [NSURL fileURLWithPath:@"/bin/launchctl"];
        task.arguments = @[@"kickstart", [NSString stringWithFormat:@"%@/%@", domain, label]];
        task.standardOutput = [NSPipe pipe];
        task.standardError = [NSPipe pipe];
        [task launchAndReturnError:nil];
    }
}

- (void)loadControlDeck {
    self.showingOfflinePage = NO;
    NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:ControlDeckURLString]
                                             cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                         timeoutInterval:6.0];
    [self.webView loadRequest:request];
}

- (void)reloadControlDeck:(id)sender {
    [self ensureLocalServices];
    [self loadControlDeck];
}

- (void)showOfflinePage {
    if (self.showingOfflinePage) return;
    self.showingOfflinePage = YES;
    NSString *html = @"<!doctype html><html><head><meta name='viewport' content='width=device-width'><style>"
        "html,body{height:100%;margin:0;background:#090c0d;color:#e8edf0;font-family:-apple-system,BlinkMacSystemFont,sans-serif}"
        "main{height:100%;display:grid;place-content:center;text-align:center;padding:32px}"
        ".mark{width:58px;height:58px;display:grid;place-items:center;margin:0 auto 24px;background:#c7fa45;color:#10140b;font-size:30px;font-weight:900}"
        "p{max-width:460px;color:#869097;line-height:1.55}a{display:inline-block;margin-top:18px;border:1px solid #56d5e2;color:#56d5e2;padding:11px 16px;text-decoration:none;font:600 11px ui-monospace;letter-spacing:.12em}"
        "</style></head><body><main><div class='mark'>C</div><h1>Bitwig Control Deck is starting.</h1><p>The local deck service is not ready yet. No internet connection is required.</p><a href='controldeck://retry'>RETRY CONNECTION</a></main></body></html>";
    [self.webView loadHTMLString:html baseURL:nil];
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *url = navigationAction.request.URL;
    if ([url.scheme isEqualToString:@"controldeck"] && [url.host isEqualToString:@"retry"]) {
        [self reloadControlDeck:nil];
        decisionHandler(WKNavigationActionPolicyCancel);
        return;
    }
    BOOL localDeck = [url.scheme isEqualToString:@"http"] &&
                     [url.host isEqualToString:@"127.0.0.1"] &&
                     (url.port.integerValue == 50703);
    BOOL internalPage = [url.scheme isEqualToString:@"about"];
    decisionHandler((localDeck || internalPage) ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    if ([webView.URL.host isEqualToString:@"127.0.0.1"]) self.showingOfflinePage = NO;
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self showOfflinePage];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self showOfflinePage];
}

@end

static int runSelfTest(void) {
    NSURL *url = [NSURL URLWithString:ControlDeckURLString];
    NSData *data = [NSData dataWithContentsOfURL:url options:0 error:nil];
    if (!data) {
        fprintf(stderr, "Bitwig Control Deck is not reachable at %s\n", ControlDeckURLString.UTF8String);
        return 2;
    }
    NSString *html = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if ([html rangeOfString:@"Control Deck"].location == NSNotFound) {
        fprintf(stderr, "Bitwig Control Deck returned unexpected content\n");
        return 3;
    }
    printf("Bitwig Control Deck native app self-test passed\n");
    return 0;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc > 1 && strcmp(argv[1], "--self-test") == 0) return runSelfTest();
        NSApplication *application = [NSApplication sharedApplication];
        ControlDeckAppDelegate *delegate = [[ControlDeckAppDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
